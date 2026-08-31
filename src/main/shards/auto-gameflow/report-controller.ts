import {
  type AutoReportCategory,
  type AutoReportScope,
  normalizeAutoReportCategories
} from '@shared/shards/auto-gameflow'
import { formatError } from '@shared/utils/errors'
import { isAxiosError } from 'axios'
import { compareStructural, computed } from 'mobx'

import type { AutoGameflowMainContext } from './context'
import {
  type ExpectedReportGameIds,
  type ReportRosterSnapshot,
  type ReportTarget,
  buildNoRetryRequestConfig,
  buildReportPayload,
  chooseReportRoster,
  classifyReportWindow,
  getCompleteFriendPuuids,
  getCompletePartyMemberPuuids,
  getMinimumRosterTargetCount,
  getRemainingRequestTimeout,
  getReportRetryDelay,
  getReportedPlayerIds,
  isAmbiguousReportStatus,
  isReportRosterForGame,
  isRetryableReportStatus,
  isTargetAlreadyReported,
  parseEogRoster,
  selectReportTargets
} from './report-logic'

// 立即首查；连续两次得到同一名单才采用。计划退避累计约 7.5 秒，快照总预算 12 秒。
const EOG_RETRY_DELAYS_MS = [0, 120, 200, 350, 600, 900, 1300, 1800, 2200] as const
const SAFETY_READ_RETRY_DELAYS_MS = [0, 250] as const
const REPORT_WINDOW_TIMEOUT_MS = 15_000
const GAME_DATA_HYDRATION_TIMEOUT_MS = 2_000
const REPORT_SNAPSHOT_TIMEOUT_MS = 12_000
const AUTO_REPORT_READ_TIMEOUT_MS = 2_000
const REPORT_SUBMISSION_TIMEOUT_MS = 45_000

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve()
      return
    }

    let timer: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', finish)
      resolve()
    }

    timer = setTimeout(finish, ms)
    signal?.addEventListener('abort', finish, { once: true })
    if (signal?.aborted) {
      finish()
    }
  })

interface ReportResult {
  target: ReportTarget
  status: 'success' | 'failed' | 'cancelled'
  detail?: string
  mayHaveSubmitted?: boolean
  stopRemaining?: boolean
}

interface ReportRunSettings {
  scope: AutoReportScope
  categories: AutoReportCategory[]
}

/**
 * [lolps] 赛后自动举报
 *
 * 名单只采用经过同局 ID、人数与稳定性校验的 EOG 全员战绩；点赞数据仅作交叉校验。
 * 自己由 EOG 身份排除；好友/同房间名单读取成功才继续，读取失败整局跳过。
 */
export class AutoGameflowReportController {
  private _handledGameKeys = new Set<string>()
  private _locallyHandledTargetIds = new Map<string, Set<string>>()
  private _running = false
  private _rerunRequested = false
  private _disposed = false
  private _activeAbortController: AbortController | null = null

  constructor(private readonly _context: AutoGameflowMainContext) {}

  private _setSummary(text: string) {
    this._context.state.setLastAutoReportSummary(text)
  }

  private _cancelActiveRun() {
    this._activeAbortController?.abort()
  }

  private _getUnsupportedReportReason() {
    const gameData = this._context.leagueClient.data.gameflow.session?.gameData
    if (gameData?.isCustomGame) {
      return '自定义对局不开放举报'
    }
    if (gameData?.queue?.gameMode === 'TFT') {
      return '云顶之弈的举报理由与普通 LOL 不同'
    }
    return null
  }

  private _isCurrentGameDataReady() {
    const gameData = this._context.leagueClient.data.gameflow.session?.gameData
    return (
      typeof gameData?.gameId === 'number' &&
      Number.isFinite(gameData.gameId) &&
      gameData.gameId > 0 &&
      typeof gameData.isCustomGame === 'boolean' &&
      typeof gameData.queue?.gameMode === 'string'
    )
  }

  private _canSubmit(signal: AbortSignal) {
    const { leagueClient, settings } = this._context
    const gameData = leagueClient.data.gameflow.session?.gameData
    return (
      !this._disposed &&
      !signal.aborted &&
      settings.autoReportEnabled &&
      leagueClient.data.gameflow.phase === 'EndOfGame' &&
      this._isCurrentGameDataReady() &&
      gameData?.isCustomGame === false &&
      this._getUnsupportedReportReason() === null
    )
  }

  private async _waitForCurrentGameData(signal: AbortSignal) {
    const { leagueClient } = this._context
    const deadline = Date.now() + GAME_DATA_HYDRATION_TIMEOUT_MS

    while (!signal.aborted && Date.now() < deadline) {
      const gameData = leagueClient.data.gameflow.session?.gameData
      if (gameData && this._isCurrentGameDataReady()) {
        return gameData
      }
      if (leagueClient.data.gameflow.phase !== 'EndOfGame') {
        return null
      }
      await sleep(100, signal)
    }

    return null
  }

  private async _getFriendPuuids(
    signal: AbortSignal,
    deadline: number
  ): Promise<Set<string> | null> {
    const { leagueClient, logger } = this._context

    for (let attempt = 0; attempt < SAFETY_READ_RETRY_DELAYS_MS.length; attempt++) {
      const delay = SAFETY_READ_RETRY_DELAYS_MS[attempt]
      if (delay > 0) {
        if (Date.now() + delay >= deadline) {
          return null
        }
        await sleep(delay, signal)
      }
      if (signal.aborted) {
        return null
      }

      try {
        const timeout = getRemainingRequestTimeout(
          deadline,
          Date.now(),
          AUTO_REPORT_READ_TIMEOUT_MS
        )
        if (timeout === null) {
          return null
        }
        const { data } = await leagueClient.http.get<unknown>(
          '/lol-chat/v1/friends',
          buildNoRetryRequestConfig(signal, timeout)
        )
        const friends = getCompleteFriendPuuids(data)
        if (friends) {
          return friends
        }
        logger.warn(`Auto-report: 好友列表格式不完整 (第 ${attempt + 1} 次)`)
      } catch (error) {
        if (!signal.aborted) {
          logger.warn(`Auto-report: 获取好友列表失败 (第 ${attempt + 1} 次): ${formatError(error)}`)
        }
      }
    }

    return null
  }

  private async _getLobbyMemberPuuids(
    signal: AbortSignal,
    deadline: number
  ): Promise<Set<string> | null> {
    const { leagueClient, logger } = this._context

    for (let attempt = 0; attempt < SAFETY_READ_RETRY_DELAYS_MS.length; attempt++) {
      const delay = SAFETY_READ_RETRY_DELAYS_MS[attempt]
      if (delay > 0) {
        if (Date.now() + delay >= deadline) {
          return null
        }
        await sleep(delay, signal)
      }
      if (signal.aborted) {
        return null
      }

      try {
        const timeout = getRemainingRequestTimeout(
          deadline,
          Date.now(),
          AUTO_REPORT_READ_TIMEOUT_MS
        )
        if (timeout === null) {
          return null
        }
        const { data: eogStatus } = await leagueClient.http.get<unknown>(
          '/lol-lobby/v2/party/eog-status',
          buildNoRetryRequestConfig(signal, timeout)
        )
        const members = getCompletePartyMemberPuuids(eogStatus)
        if (members) {
          return members
        }
        logger.warn(`Auto-report: 房间成员列表尚未完整 (第 ${attempt + 1} 次)`)
      } catch (error) {
        if (!signal.aborted) {
          logger.warn(`Auto-report: 获取房间成员失败 (第 ${attempt + 1} 次): ${formatError(error)}`)
        }
      }
    }

    return null
  }

  private async _getAlreadyReported(
    gameId: number,
    signal: AbortSignal,
    deadline: number
  ): Promise<Set<string> | null> {
    const { leagueClient, logger } = this._context

    for (let attempt = 0; attempt < SAFETY_READ_RETRY_DELAYS_MS.length; attempt++) {
      const delay = SAFETY_READ_RETRY_DELAYS_MS[attempt]
      if (delay > 0) {
        if (Date.now() + delay >= deadline) {
          return null
        }
        await sleep(delay, signal)
      }
      if (signal.aborted) {
        return null
      }

      try {
        const timeout = getRemainingRequestTimeout(
          deadline,
          Date.now(),
          AUTO_REPORT_READ_TIMEOUT_MS
        )
        if (timeout === null) {
          return null
        }
        const { data } = await leagueClient.http.get<unknown>(
          `/lol-player-report-sender/v1/reported-players/gameId/${gameId}`,
          buildNoRetryRequestConfig(signal, timeout)
        )
        const reported = getReportedPlayerIds(data)
        if (reported) {
          return reported
        }
        logger.warn(`Auto-report: 已举报名单格式不完整 (第 ${attempt + 1} 次)`)
      } catch (error) {
        if (!signal.aborted) {
          logger.warn(
            `Auto-report: 查询已举报名单失败 (第 ${attempt + 1} 次): ${formatError(error)}`
          )
        }
      }
    }

    return null
  }

  private async _fetchEogRoster(
    myPuuid: string | undefined,
    expectedGameIds: ExpectedReportGameIds,
    minimumTargetCount: number,
    signal: AbortSignal,
    deadline: number
  ): Promise<ReportRosterSnapshot | null> {
    const { leagueClient, logger } = this._context
    let previousFingerprint: string | null = null

    for (let attempt = 0; attempt < EOG_RETRY_DELAYS_MS.length; attempt++) {
      if (!this._canSubmit(signal)) {
        return null
      }
      if (Date.now() >= deadline) {
        return null
      }

      const delay = EOG_RETRY_DELAYS_MS[attempt]
      if (delay > 0) {
        if (Date.now() + delay >= deadline) {
          return null
        }
        await sleep(delay, signal)
        if (!this._canSubmit(signal)) {
          return null
        }
      }

      try {
        const timeout = getRemainingRequestTimeout(
          deadline,
          Date.now(),
          AUTO_REPORT_READ_TIMEOUT_MS
        )
        if (timeout === null) {
          return null
        }
        const { data } = await leagueClient.http.get<unknown>(
          '/lol-end-of-game/v1/eog-stats-block',
          buildNoRetryRequestConfig(signal, timeout)
        )
        const roster = parseEogRoster(data, myPuuid)
        if (!roster) {
          throw new Error('stats block is incomplete')
        }
        if (!isReportRosterForGame(roster, expectedGameIds)) {
          previousFingerprint = null
          throw new Error(
            `stale stats block (${roster.statsGameId}/${roster.reportGameId}), expected ${expectedGameIds.statsGameId ?? '-'}/${expectedGameIds.reportGameId ?? '-'}`
          )
        }
        if (roster.targets.length < minimumTargetCount) {
          previousFingerprint = null
          throw new Error(
            `stats block has ${roster.targets.length} targets, expected at least ${minimumTargetCount}`
          )
        }

        const fingerprint = `${roster.statsGameId}:${roster.reportGameId}:${roster.targets
          .map(
            (target) =>
              `${target.puuid}:${target.summonerId}:${target.side}:${target.obfuscatedPuuid ?? ''}`
          )
          .sort()
          .join(',')}`
        if (fingerprint === previousFingerprint) {
          return roster
        }
        previousFingerprint = fingerprint
      } catch (error) {
        if (signal.aborted) {
          return null
        }
        previousFingerprint = null
        logger.info(`Auto-report: 获取结算名单失败 (第 ${attempt + 1} 次): ${formatError(error)}`)
      }
    }

    return null
  }

  private async _waitForReportWindow(
    timeoutMs: number,
    signal: AbortSignal
  ): Promise<'ready' | 'left' | 'timeout' | 'disabled'> {
    const { leagueClient, settings } = this._context
    const deadline = Date.now() + timeoutMs

    while (Date.now() < deadline) {
      if (this._disposed || signal.aborted) {
        return 'disabled'
      }

      const state = classifyReportWindow(
        leagueClient.data.gameflow.phase,
        settings.autoReportEnabled
      )
      if (state !== 'wait') {
        return state
      }
      await sleep(250, signal)
    }

    return 'timeout'
  }

  private async _submitReport(
    gameId: number,
    target: ReportTarget,
    categories: AutoReportCategory[],
    signal: AbortSignal,
    timeout: number
  ) {
    const { leagueClient } = this._context

    // 与当前 Riot 客户端实际提交的字段保持一致。
    return leagueClient.http.post(
      '/lol-player-report-sender/v1/end-of-game-reports',
      buildReportPayload(gameId, target, categories),
      buildNoRetryRequestConfig(signal, timeout)
    )
  }

  private _formatSubmitError(error: unknown) {
    return isAxiosError(error) && error.response
      ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)}`
      : formatError(error)
  }

  private _isRetryableSubmitError(error: unknown) {
    if (!isAxiosError(error) || error.code === 'ERR_CANCELED') {
      return false
    }
    return isRetryableReportStatus(error.response?.status)
  }

  private _getRetryDelay(error: unknown) {
    if (isAxiosError(error) && error.response?.status === 429) {
      return getReportRetryDelay(error.response.headers['retry-after'])
    }
    return getReportRetryDelay(undefined)
  }

  private async _submitTarget(
    statsGameId: number,
    reportGameId: number,
    target: ReportTarget,
    categories: AutoReportCategory[],
    signal: AbortSignal,
    submissionDeadline: number
  ): Promise<ReportResult> {
    let mayHaveSubmitted = false

    for (let attempt = 1; attempt <= 2; attempt++) {
      if (!this._canSubmit(signal)) {
        return { target, status: 'cancelled', mayHaveSubmitted }
      }
      const requestTimeout = getRemainingRequestTimeout(submissionDeadline)
      if (requestTimeout === null) {
        return {
          target,
          status: 'failed',
          detail: '整局举报提交已达到 45 秒安全时限',
          stopRemaining: true
        }
      }

      try {
        mayHaveSubmitted = true
        await this._submitReport(reportGameId, target, categories, signal, requestTimeout)
        return { target, status: 'success' }
      } catch (error) {
        const responseStatus = isAxiosError(error) ? error.response?.status : undefined
        const retryable = this._isRetryableSubmitError(error)
        if (!this._canSubmit(signal)) {
          return { target, status: 'cancelled', mayHaveSubmitted }
        }

        const detail = this._formatSubmitError(error)
        const ambiguous = isAxiosError(error) && isAmbiguousReportStatus(responseStatus)
        const mayAlreadyBeReported =
          ambiguous || retryable || (isAxiosError(error) && responseStatus === 409)

        // 所有可能已被服务端接收的结果都先查去重状态；查不清就保守停止。
        if (mayAlreadyBeReported) {
          const reported = await this._getAlreadyReported(statsGameId, signal, submissionDeadline)
          if (!this._canSubmit(signal)) {
            return { target, status: 'cancelled', mayHaveSubmitted }
          }
          if (reported && isTargetAlreadyReported(target, reported)) {
            return { target, status: 'success' }
          }
          if (!reported) {
            return {
              target,
              status: 'failed',
              detail: `${detail}（无法核验是否已提交，未重复发送）`,
              stopRemaining: Date.now() >= submissionDeadline
            }
          }
          if (retryable) {
            // 只有已举报 GET 成功且明确不含该目标，才允许把 425/429 当作可重试。
            mayHaveSubmitted = false
          }
        }

        if (attempt === 2 || !retryable) {
          return {
            target,
            status: 'failed',
            detail: ambiguous ? `${detail}（提交状态不确定，未重复发送）` : detail
          }
        }

        const retryDelay = this._getRetryDelay(error)
        if (retryDelay === null) {
          return {
            target,
            status: 'failed',
            detail: `${detail}（Retry-After 超过 30 秒，为避免长时间阻塞未重试）`
          }
        }
        if (Date.now() + retryDelay >= submissionDeadline) {
          return {
            target,
            status: 'failed',
            detail: `${detail}（等待重试会超过整局 45 秒安全时限，已停止）`,
            stopRemaining: true
          }
        }
        await sleep(retryDelay, signal)
      }
    }

    return { target, status: 'failed', detail: 'unknown error' }
  }

  private _rememberHandledGame(gameKey: string) {
    this._handledGameKeys.add(gameKey)
    if (this._handledGameKeys.size > 50) {
      const retained = [...this._handledGameKeys].slice(-25)
      this._handledGameKeys = new Set(retained)
      this._locallyHandledTargetIds = new Map(
        retained.flatMap((key) => {
          const reported = this._locallyHandledTargetIds.get(key)
          return reported ? [[key, reported] as const] : []
        })
      )
    }
  }

  private _rememberHandledTarget(gameKey: string, target: ReportTarget) {
    const ids = this._locallyHandledTargetIds.get(gameKey) ?? new Set<string>()
    ids.add(target.puuid)
    if (target.obfuscatedPuuid) {
      ids.add(target.obfuscatedPuuid)
    }
    if (target.summonerId > 0) {
      ids.add(String(target.summonerId))
    }
    this._locallyHandledTargetIds.set(gameKey, ids)
  }

  private async _runForGame(
    ballotGameId: number | null,
    ballotTargets: ReportTarget[],
    runSettings: ReportRunSettings
  ) {
    const { leagueClient, logger } = this._context
    const abortController = new AbortController()
    const { signal } = abortController
    this._activeAbortController = abortController

    try {
      const initialUnsupportedReason = this._getUnsupportedReportReason()
      if (initialUnsupportedReason) {
        this._setSummary(`上一局：${initialUnsupportedReason}，已跳过`)
        logger.info(`Auto-report: ${initialUnsupportedReason}, 本局跳过`)
        return
      }

      const { scope, categories } = runSettings
      if (categories.length === 0) {
        this._setSummary('上一局：未勾选任何举报理由，未执行举报')
        logger.info('Auto-report: 未选择任何举报理由, 跳过')
        return
      }

      if (leagueClient.data.gameflow.phase !== 'EndOfGame') {
        const waited = await this._waitForReportWindow(REPORT_WINDOW_TIMEOUT_MS, signal)
        if (waited === 'disabled') {
          logger.info('Auto-report: 等待期间功能被关闭, 本局取消')
          return
        }
        if (waited === 'left') {
          logger.info('Auto-report: 已离开结算流程, 本局取消')
          return
        }
        if (waited === 'timeout') {
          this._setSummary('上一局：等待结算界面超时，未执行举报')
          logger.warn('Auto-report: 等待结算界面超时, 本局取消')
          return
        }
      }

      const gameData = await this._waitForCurrentGameData(signal)
      if (!gameData) {
        if (!signal.aborted) {
          this._setSummary('上一局：对局信息未就绪，为避免错局举报已跳过')
          logger.warn('Auto-report: 对局信息未在安全时限内就绪, 本局跳过')
        }
        return
      }

      const unsupportedReason = this._getUnsupportedReportReason()
      if (unsupportedReason) {
        this._setSummary(`上一局：${unsupportedReason}，已跳过`)
        logger.info(`Auto-report: ${unsupportedReason}, 本局跳过`)
        return
      }

      const currentGameId = gameData.gameId
      const validCurrentGameId =
        typeof currentGameId === 'number' && Number.isFinite(currentGameId) && currentGameId > 0
          ? currentGameId
          : null
      const validBallotGameId =
        typeof ballotGameId === 'number' && Number.isFinite(ballotGameId) && ballotGameId > 0
          ? ballotGameId
          : null
      // 两个 ID 属于不同用途：gameflow 辅助校验 EOG 根 ID，ballot 校验举报 ID。
      const expectedGameIds: ExpectedReportGameIds = {
        statsGameId: validCurrentGameId,
        reportGameId: validBallotGameId
      }

      const myPuuid = leagueClient.data.summoner.me?.puuid
      const configuredPlayerCount = Math.max(
        gameData.queue?.maximumParticipantListSize ?? 0,
        (gameData.queue?.numPlayersPerTeam ?? 0) * 2
      )
      const minimumTargetCount = getMinimumRosterTargetCount(
        ballotTargets.length,
        [...(gameData.teamOne ?? []), ...(gameData.teamTwo ?? [])].map((player) => player.puuid),
        myPuuid,
        configuredPlayerCount
      )
      const snapshotDeadline = Date.now() + REPORT_SNAPSHOT_TIMEOUT_MS
      // 两个独立的安全排除读取与 EOG 轮询并行，隐藏网络等待但不并发提交举报。
      const friendsPromise = this._getFriendPuuids(signal, snapshotDeadline)
      const lobbyMembersPromise = this._getLobbyMemberPuuids(signal, snapshotDeadline)
      const eog = await this._fetchEogRoster(
        myPuuid,
        expectedGameIds,
        minimumTargetCount,
        signal,
        snapshotDeadline
      )
      if (!this._canSubmit(signal)) {
        return
      }

      const roster = chooseReportRoster(eog, expectedGameIds)
      if (!roster) {
        this._setSummary('上一局：未能取得同一局的对局 ID 与玩家名单，未执行举报')
        logger.warn('Auto-report: 无法取得完整同局快照, 本局取消')
        return
      }

      const { statsGameId, reportGameId } = roster
      const gameKey = `${statsGameId}:${reportGameId}`
      if (this._handledGameKeys.has(gameKey)) {
        return
      }

      let [friends, lobbyMembers, alreadyReported] = await Promise.all([
        friendsPromise,
        lobbyMembersPromise,
        this._getAlreadyReported(statsGameId, signal, snapshotDeadline)
      ])

      // 结算刚进入时 party eog-status 可能仍在水合；保留并行首查的速度，
      // 但 EOG 已稳定后对早期失败项再做一轮短复查。
      if (!friends || !lobbyMembers) {
        const refreshedSafetyLists = await Promise.all([
          friends ? Promise.resolve(friends) : this._getFriendPuuids(signal, snapshotDeadline),
          lobbyMembers
            ? Promise.resolve(lobbyMembers)
            : this._getLobbyMemberPuuids(signal, snapshotDeadline)
        ])
        friends = refreshedSafetyLists[0]
        lobbyMembers = refreshedSafetyLists[1]
      }

      if (!this._canSubmit(signal)) {
        return
      }
      if (!friends) {
        this._setSummary('上一局：好友列表获取失败，为避免误伤好友已跳过')
        return
      }
      if (!lobbyMembers) {
        this._setSummary('上一局：开黑房间成员获取失败，为避免误伤队友已跳过')
        return
      }
      if (!alreadyReported) {
        this._setSummary('上一局：已举报名单获取失败，为避免重复举报已跳过')
        return
      }

      for (const id of this._locallyHandledTargetIds.get(gameKey) ?? []) {
        alreadyReported.add(id)
      }

      const excluded = new Set<string>([...friends, ...lobbyMembers])
      if (myPuuid) {
        excluded.add(myPuuid)
      }

      if (
        scope === 'opponents-only' &&
        !roster.targets.some((target) => target.side === 'opponent')
      ) {
        this._setSummary('上一局：未能可靠确认敌方阵营，为避免误伤队友已跳过')
        logger.warn(`Auto-report: 无法可靠确认敌方阵营, game IDs: ${statsGameId}/${reportGameId}`)
        return
      }

      const targets = selectReportTargets(roster.targets, {
        scope,
        excludedPuuids: excluded,
        alreadyReportedIds: alreadyReported
      })

      if (targets.length === 0) {
        this._setSummary('上一局：排除自己 / 开黑 / 好友 / 已举报玩家后无可举报对象')
        this._rememberHandledGame(gameKey)
        logger.info(`Auto-report: 排除后无可举报对象, game IDs: ${statsGameId}/${reportGameId}`)
        return
      }

      // 并发语义没有可靠保证：保持逐个等待响应，但不再增加人为间隔。
      const results: ReportResult[] = []
      const submissionDeadline = Date.now() + REPORT_SUBMISSION_TIMEOUT_MS
      let submissionTimedOut = false
      for (const target of targets) {
        if (Date.now() >= submissionDeadline) {
          submissionTimedOut = true
          break
        }
        const result = await this._submitTarget(
          statsGameId,
          reportGameId,
          target,
          categories,
          signal,
          submissionDeadline
        )
        results.push(result)
        if (result.status !== 'cancelled' || result.mayHaveSubmitted) {
          this._rememberHandledTarget(gameKey, target)
        }
        if (result.stopRemaining) {
          submissionTimedOut = true
        }
        if (result.status === 'cancelled' || result.stopRemaining) {
          break
        }
      }

      const ok = results.filter((result) => result.status === 'success').length
      const failures = results.filter((result) => result.status === 'failed')
      const cancelled = results.some((result) => result.status === 'cancelled')
      const scopeText = scope === 'all' ? '敌我全部' : '仅敌方'

      if (cancelled) {
        this._setSummary(`上一局：执行期间已取消，取消前成功举报 ${ok} 人（${scopeText}）`)
      } else if (submissionTimedOut) {
        this._setSummary(
          `上一局：提交达到 45 秒安全时限，已停止；成功 ${ok} 人，失败 ${failures.length} 人，未继续 ${targets.length - results.length} 人（${scopeText}）`
        )
      } else if (failures.length === 0) {
        this._setSummary(`上一局：已举报 ${ok} 人（${scopeText}）`)
      } else {
        this._setSummary(
          `上一局：已举报 ${ok} 人，失败 ${failures.length} 人（${scopeText}），详情见日志`
        )
      }

      if (!cancelled) {
        // 每名目标本轮最多两次；失败也封存本局，避免事件重放把上限放大。
        this._rememberHandledGame(gameKey)
      }

      logger.info(
        `Auto-report: 已举报 ${ok}/${targets.length} 人, 范围 ${scope}, 理由 ${categories.join(',')}, game IDs: ${statsGameId}/${reportGameId}`
      )
      if (failures.length > 0) {
        logger.warn(
          `Auto-report: 失败明细 -> ${failures
            .map((result) => `${result.target.summonerName}: ${result.detail}`)
            .join(' | ')}`
        )
      }
    } catch (error) {
      if (!signal.aborted) {
        this._setSummary('上一局：举报执行出错，详情见日志')
        logger.warn(`Auto-report error: ${formatError(error)}`)
      }
    } finally {
      abortController.abort()
      if (this._activeAbortController === abortController) {
        this._activeAbortController = null
      }
    }
  }

  watch() {
    const { leagueClient, logger, mobxUtils, settings } = this._context

    const ballotSnapshot = computed(() => {
      if (!leagueClient.data.honor.ballot) {
        return null
      }

      const { eligibleAllies, eligibleOpponents, gameId } = leagueClient.data.honor.ballot
      const toTargets = (
        players: typeof eligibleAllies,
        side: ReportTarget['side']
      ): ReportTarget[] =>
        players
          .filter((player) => !player.botPlayer)
          .map((player) => ({
            puuid: player.puuid,
            summonerId: player.summonerId,
            summonerName: player.summonerName,
            side
          }))

      return {
        gameId,
        targets: [...toTargets(eligibleAllies, 'ally'), ...toTargets(eligibleOpponents, 'opponent')]
      }
    })

    mobxUtils.reaction(
      () =>
        [
          ballotSnapshot.get(),
          leagueClient.data.gameflow.phase,
          settings.autoReportEnabled,
          this._getUnsupportedReportReason(),
          leagueClient.data.gameflow.session?.gameData.gameId ?? null,
          this._isCurrentGameDataReady()
        ] as const,
      async (
        [ballot, phase, enabled, unsupportedReason, currentGameId, gameDataReady],
        previous
      ) => {
        const windowState = classifyReportWindow(phase, enabled)
        if (windowState === 'disabled' || windowState === 'left') {
          this._cancelActiveRun()
          return
        }

        if (this._running) {
          const ballotChanged = previous !== undefined && ballot !== previous[0]
          const phaseReentered =
            previous !== undefined &&
            classifyReportWindow(previous[1], previous[2]) === 'left' &&
            (windowState === 'ready' || windowState === 'wait')
          const runEligibilityChanged =
            previous !== undefined &&
            (enabled !== previous[2] ||
              unsupportedReason !== previous[3] ||
              currentGameId !== previous[4] ||
              gameDataReady !== previous[5])
          if (runEligibilityChanged) {
            this._cancelActiveRun()
          }
          this._rerunRequested =
            this._rerunRequested ||
            ballotChanged ||
            phaseReentered ||
            (runEligibilityChanged && enabled)
          return
        }

        this._running = true
        const runSettings: ReportRunSettings = {
          scope: settings.autoReportScope,
          categories: normalizeAutoReportCategories(settings.autoReportCategories)
        }
        this._context.state.setAutoReporting(runSettings.categories.length > 0)
        try {
          do {
            this._rerunRequested = false
            const latestBallot = ballotSnapshot.get()
            await this._runForGame(
              latestBallot?.gameId ?? null,
              latestBallot?.targets ?? [],
              runSettings
            )
          } while (
            this._rerunRequested &&
            !this._disposed &&
            ['ready', 'wait'].includes(
              classifyReportWindow(leagueClient.data.gameflow.phase, settings.autoReportEnabled)
            )
          )
        } catch (error) {
          logger.warn(`Auto-report error: ${formatError(error)}`)
        } finally {
          this._running = false
          this._context.state.setAutoReporting(false)
        }
      },
      {
        equals: compareStructural,
        fireImmediately: true
      }
    )
  }

  dispose() {
    this._disposed = true
    this._cancelActiveRun()
  }
}
