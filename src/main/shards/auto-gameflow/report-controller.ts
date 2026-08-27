import { formatError } from '@shared/utils/errors'
import { isAxiosError } from 'axios'
import { compareStructural, computed } from 'mobx'

import type { AutoGameflowMainContext } from './context'

interface ReportTarget {
  puuid: string
  summonerId: number
  summonerName: string
  side: 'ally' | 'opponent' | 'unknown'
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * [lolps] 赛后自动举报（检修强化版）
 *
 * 与旧版的区别：
 *  1. 名单来源改为 EOG 全员战绩名单（/lol-end-of-game/v1/eog-stats-block），
 *     覆盖全部 10 人（包括挂机者）。旧版取自点赞资格名单，而挂机 / 违规者
 *     恰恰常被排除在"可点赞"名单之外，导致最想举报的人反而举报不到。
 *     点赞名单仍作为兜底来源保留。
 *  2. 提交时机延后到结算数据页（gameflow 进入 EndOfGame）——这是客户端
 *     自身举报按钮出现的阶段，最稳妥；点赞投票阶段仅用于"预热"。
 *  3. 每个目标最多尝试 2 次提交，间隔重试，并完整记录失败的 HTTP 状态与响应体。
 *  4. 每局结果写入 lastAutoReportSummary，直接显示在设置页里，
 *     无需翻日志即可确认是否执行、举报了几个人、为何跳过。
 *
 * 三重排除（永远不举报）：自己、同房间开黑的人、好友列表中的人。
 * 好友或房间名单获取失败时宁可整局跳过，绝不冒险误伤。
 */
export class AutoGameflowReportController {
  private _reportedGameIds = new Set<number>()
  private _running = false

  constructor(private readonly _context: AutoGameflowMainContext) {}

  private _setSummary(text: string) {
    this._context.state.setLastAutoReportSummary(text)
  }

  /** 好友 puuid 集合，两次尝试，失败返回 null 表示不可信 */
  private async _getFriendPuuids(): Promise<Set<string> | null> {
    const { leagueClient, logger } = this._context

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const { data } = await leagueClient.api.chat.getFriends()
        return new Set(data.map((f) => f.puuid).filter(Boolean))
      } catch (error) {
        logger.warn(`Auto-report: 获取好友列表失败 (第 ${attempt} 次): ${formatError(error)}`)
        if (attempt === 1) {
          await sleep(1500)
        }
      }
    }
    return null
  }

  /** 同房间开黑成员 puuid 集合，两次尝试，失败返回 null 表示不可信 */
  private async _getLobbyMemberPuuids(): Promise<Set<string> | null> {
    const { leagueClient, logger } = this._context

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const eogStatus = (await leagueClient.api.lobby.getEogStatus()).data
        return new Set(
          [...eogStatus.eogPlayers, ...eogStatus.leftPlayers, ...eogStatus.readyPlayers].filter(
            Boolean
          )
        )
      } catch (error) {
        logger.warn(`Auto-report: 获取房间成员失败 (第 ${attempt} 次): ${formatError(error)}`)
        if (attempt === 1) {
          await sleep(1500)
        }
      }
    }
    return null
  }

  /** 客户端记录中本局已被举报过的人（失败不致命） */
  private async _getAlreadyReported(gameId: number): Promise<Set<string>> {
    const { leagueClient, logger } = this._context

    try {
      const { data } = await leagueClient.api.playerReportSender.getReportedPlayersByGameId(gameId)
      return new Set((data || []).map((v) => String(v)))
    } catch (error) {
      logger.info(`Auto-report: 查询已举报名单失败（不影响举报）: ${formatError(error)}`)
      return new Set<string>()
    }
  }

  /**
   * 从 EOG 战绩页取全员名单（含挂机者）。
   * 返回 null 表示暂不可用（例如结算数据尚未生成）。
   */
  private async _fetchEogRoster(
    myPuuid: string | undefined
  ): Promise<{ gameId: number | null; targets: ReportTarget[] } | null> {
    const { leagueClient, logger } = this._context

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const { data } = await leagueClient.http.get<any>('/lol-end-of-game/v1/eog-stats-block')

        if (!data || typeof data !== 'object') {
          throw new Error('empty stats block')
        }

        const gameId = typeof data.gameId === 'number' ? data.gameId : null
        const targets: ReportTarget[] = []

        const pushPlayer = (p: any, side: ReportTarget['side']) => {
          if (!p || typeof p !== 'object') {
            return
          }
          if (p.botPlayer === true || p.isBot === true) {
            return
          }
          const puuid = p.puuid || p.PUUID
          if (!puuid || typeof puuid !== 'string') {
            return
          }
          const summonerName =
            p.summonerName ||
            (p.riotIdGameName ? `${p.riotIdGameName}#${p.riotIdTagLine ?? ''}` : '') ||
            p.championName ||
            'unknown'
          targets.push({
            puuid,
            summonerId: typeof p.summonerId === 'number' ? p.summonerId : 0,
            summonerName,
            side
          })
        }

        if (Array.isArray(data.teams)) {
          for (const team of data.teams) {
            const players = Array.isArray(team?.players) ? team.players : []
            let side: ReportTarget['side'] = 'unknown'
            if (team?.isPlayerTeam === true) {
              side = 'ally'
            } else if (team?.isPlayerTeam === false) {
              side = 'opponent'
            } else if (myPuuid) {
              const hasMe = players.some((p: any) => (p?.puuid || p?.PUUID) === myPuuid)
              side = hasMe ? 'ally' : 'opponent'
            }
            for (const p of players) {
              pushPlayer(p, side)
            }
          }
        } else if (Array.isArray(data.players)) {
          for (const p of data.players) {
            pushPlayer(p, 'unknown')
          }
        }

        if (targets.length === 0) {
          throw new Error('stats block has no players')
        }

        return { gameId, targets }
      } catch (error) {
        logger.info(`Auto-report: 获取结算名单失败 (第 ${attempt} 次): ${formatError(error)}`)
        if (attempt < 3) {
          await sleep(2500)
        }
      }
    }
    return null
  }

  /** 等待举报窗口（结算数据页）。到达 / 离开 / 超时 / 中途被关闭开关都会返回。 */
  private async _waitForReportWindow(timeoutMs: number): Promise<'ready' | 'left' | 'timeout' | 'disabled'> {
    const { leagueClient, settings } = this._context

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (!settings.autoReportEnabled) {
        return 'disabled'
      }
      const phase = leagueClient.data.gameflow.phase
      if (phase === 'EndOfGame') {
        return 'ready'
      }
      if (phase === null || phase === 'None' || phase === 'Lobby' || phase === 'Matchmaking') {
        return 'left'
      }
      await sleep(1000)
    }
    return 'timeout'
  }

  private async _submitReport(gameId: number, target: ReportTarget, categories: string[]) {
    const { leagueClient } = this._context

    // 同时携带 puuid 与 summonerId，兼容不同客户端版本对字段的要求
    return leagueClient.http.post('/lol-player-report-sender/v1/end-of-game-reports', {
      gameId,
      offenderPuuid: target.puuid,
      offenderSummonerId: target.summonerId,
      categories,
      comment: ''
    })
  }

  private async _runForGame(ballotGameId: number | null, ballotTargets: ReportTarget[]) {
    const { leagueClient, logger, settings } = this._context

    // —— 1. 等待进入结算数据页（客户端举报通道开放的阶段） ——
    if (leagueClient.data.gameflow.phase !== 'EndOfGame') {
      const waited = await this._waitForReportWindow(120_000)
      if (waited === 'disabled') {
        logger.info('Auto-report: 等待期间开关被关闭, 本局取消')
        return
      }
      if (waited === 'timeout') {
        logger.warn('Auto-report: 等待结算界面超时, 仍将尝试提交')
      }
    }
    await sleep(2500)

    // —— 2. 组装名单：优先 EOG 全员名单（含挂机者），点赞名单兜底 ——
    const myPuuid = leagueClient.data.summoner.me?.puuid
    const eog = await this._fetchEogRoster(myPuuid)

    let roster: ReportTarget[]
    let gameId: number | null

    if (eog) {
      roster = eog.targets
      gameId = eog.gameId ?? ballotGameId
    } else {
      roster = ballotTargets
      gameId = ballotGameId
    }

    if (!gameId) {
      this._setSummary('上一局：未能确认对局 ID，未执行举报')
      logger.warn('Auto-report: 无法确定 gameId, 放弃本局')
      return
    }

    if (this._reportedGameIds.has(gameId)) {
      return
    }
    this._reportedGameIds.add(gameId)
    if (this._reportedGameIds.size > 50) {
      this._reportedGameIds = new Set([...this._reportedGameIds].slice(-25))
    }

    if (roster.length === 0) {
      this._setSummary('上一局：未能获取玩家名单，未执行举报')
      logger.warn(`Auto-report: 名单为空, 放弃, game ID: ${gameId}`)
      return
    }

    const categories = settings.autoReportCategories
    if (!categories || categories.length === 0) {
      this._setSummary('上一局：未勾选任何举报理由，未执行举报')
      logger.info('Auto-report: 未选择任何举报理由, 跳过')
      return
    }

    try {
      // —— 3. 排除名单 ——
      const excluded = new Set<string>()
      if (myPuuid) {
        excluded.add(myPuuid)
      }

      const friends = await this._getFriendPuuids()
      if (!friends) {
        this._setSummary('上一局：好友列表获取失败，为避免误伤好友已跳过')
        logger.warn('Auto-report: 好友列表不可用, 为避免误伤好友, 本局跳过举报')
        return
      }
      for (const puuid of friends) {
        excluded.add(puuid)
      }

      const lobbyMembers = await this._getLobbyMemberPuuids()
      if (!lobbyMembers) {
        this._setSummary('上一局：开黑房间成员获取失败，为避免误伤队友已跳过')
        logger.warn('Auto-report: 房间成员不可用, 为避免误伤开黑队友, 本局跳过举报')
        return
      }
      for (const puuid of lobbyMembers) {
        excluded.add(puuid)
      }

      // —— 4. 按范围筛选目标 ——
      const alreadyReported = await this._getAlreadyReported(gameId)
      const scope = settings.autoReportScope

      const seen = new Set<string>()
      const targets = roster.filter((t) => {
        if (scope === 'opponents-only' && t.side === 'ally') {
          return false
        }
        if (!t.puuid || excluded.has(t.puuid) || seen.has(t.puuid)) {
          return false
        }
        if (alreadyReported.has(t.puuid) || alreadyReported.has(String(t.summonerId))) {
          return false
        }
        seen.add(t.puuid)
        return true
      })

      if (targets.length === 0) {
        this._setSummary(`上一局：排除自己 / 开黑 / 好友后无可举报对象`)
        logger.info(
          `Auto-report: 排除后无可举报对象 (排除名单 ${excluded.size} 人), game ID: ${gameId}`
        )
        return
      }

      // —— 5. 逐个提交，每人最多 2 次 ——
      let ok = 0
      const failures: string[] = []
      for (const target of targets) {
        let done = false
        for (let attempt = 1; attempt <= 2 && !done; attempt++) {
          try {
            await this._submitReport(gameId, target, categories)
            done = true
            ok++
          } catch (error) {
            const detail =
              isAxiosError(error) && error.response
                ? `HTTP ${error.response.status} ${JSON.stringify(error.response.data)}`
                : formatError(error)
            if (attempt === 2) {
              failures.push(`${target.summonerName}: ${detail}`)
            } else {
              await sleep(1200)
            }
          }
        }
        await sleep(400)
      }

      const scopeText = scope === 'all' ? '敌我全部' : '仅敌方'
      const summary =
        failures.length === 0
          ? `上一局：已举报 ${ok} 人（${scopeText}）`
          : `上一局：已举报 ${ok} 人，失败 ${failures.length} 人（${scopeText}），详情见日志`
      this._setSummary(summary)

      logger.info(
        `Auto-report: 已举报 ${ok}/${targets.length} 人, 范围 ${scope}, 理由 ${categories.join(',')}, game ID: ${gameId}`
      )
      if (failures.length) {
        logger.warn(`Auto-report: 失败明细 -> ${failures.join(' | ')}`)
      }
    } catch (error) {
      this._setSummary('上一局：举报执行出错，详情见日志')
      logger.warn(`Auto-report error: ${formatError(error)}`)
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
      () => [
        ballotSnapshot.get(),
        leagueClient.data.gameflow.phase,
        settings.autoReportEnabled
      ] as const,
      async ([ballot, phase, enabled]) => {
        if (!enabled) {
          return
        }

        const inWindow =
          ballot !== null || phase === 'PreEndOfGame' || phase === 'EndOfGame'
        if (!inWindow) {
          return
        }

        if (this._running) {
          return
        }
        this._running = true

        try {
          await this._runForGame(ballot?.gameId ?? null, ballot?.targets ?? [])
        } catch (error) {
          logger.warn(`Auto-report error: ${formatError(error)}`)
        } finally {
          this._running = false
        }
      },
      {
        equals: compareStructural,
        fireImmediately: true
      }
    )
  }
}
