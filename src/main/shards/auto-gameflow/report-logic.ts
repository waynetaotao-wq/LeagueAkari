import type { AutoReportCategory, AutoReportScope } from '@shared/shards/auto-gameflow'
import type { AxiosRequestConfig } from 'axios'

export type ReportSide = 'ally' | 'opponent' | 'unknown'

export interface ReportTarget {
  puuid: string
  obfuscatedPuuid?: string
  summonerId: number
  summonerName: string
  side: ReportSide
}

export interface ReportRosterSnapshot {
  /** 查询本局已举报玩家使用的 EOG 根 gameId。 */
  statsGameId: number
  /** 提交举报使用的 reportGameId（并与玩家 gameId 校验一致）。 */
  reportGameId: number
  targets: ReportTarget[]
  source: 'eog'
}

export interface ExpectedReportGameIds {
  statsGameId: number | null
  reportGameId: number | null
}

type UnknownRecord = Record<string, unknown>

const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === 'object' ? (value as UnknownRecord) : null

const readString = (value: unknown) => (typeof value === 'string' && value ? value : undefined)

const readGameId = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null

const getPlayerPuuid = (player: UnknownRecord) =>
  readString(player.puuid) ?? readString(player.PUUID)

const getObfuscatedPuuid = (player: UnknownRecord) =>
  readString(player.obfuscatedPuuid) ?? readString(player.obfuscatedPUUID)

const getSummonerId = (player: UnknownRecord) =>
  typeof player.summonerId === 'number' &&
  Number.isFinite(player.summonerId) &&
  player.summonerId > 0
    ? player.summonerId
    : null

export function getCompleteFriendPuuids(raw: unknown): Set<string> | null {
  if (!Array.isArray(raw)) {
    return null
  }

  const puuids: string[] = []
  for (const value of raw) {
    const friend = asRecord(value)
    const puuid = friend && getPlayerPuuid(friend)
    if (!puuid) {
      return null
    }
    puuids.push(puuid)
  }
  return new Set(puuids)
}

export function getReportedPlayerIds(raw: unknown): Set<string> | null {
  if (!Array.isArray(raw)) {
    return null
  }

  const ids: string[] = []
  for (const value of raw) {
    if (typeof value === 'string' && value.length > 0) {
      ids.push(value)
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      ids.push(String(value))
      continue
    }
    return null
  }
  return new Set(ids)
}

/** 只有三个状态分区恰好组成完整且无重复的开黑名单时才采用。 */
export function getCompletePartyMemberPuuids(status: unknown): Set<string> | null {
  const data = asRecord(status)
  if (!data || !Number.isInteger(data.partySize) || (data.partySize as number) <= 0) {
    return null
  }

  const groups = [data.eogPlayers, data.leftPlayers, data.readyPlayers]
  if (groups.some((group) => !Array.isArray(group))) {
    return null
  }

  const members = groups.flat()
  if (!members.every((puuid): puuid is string => typeof puuid === 'string' && puuid.length > 0)) {
    return null
  }

  const uniqueMembers = new Set(members)
  if (uniqueMembers.size !== members.length || uniqueMembers.size !== data.partySize) {
    return null
  }
  return uniqueMembers
}

/**
 * 解析同一个 EOG 快照中的举报 ID 与玩家名单。
 *
 * 这里对应 `/lol-end-of-game/v1/eog-stats-block` 的 `teams[].players` 结构；
 * 不要和另一个 `/gameclient-eog-stats-block` 的 `statsBlock.players` 结构混用。
 * 名单与 ID 必须成套返回，避免把上一局 EOG 名单和下一局点赞 ballot 的 ID 混用。
 */
export function parseEogRoster(raw: unknown, statePuuid?: string): ReportRosterSnapshot | null {
  const data = asRecord(raw)
  if (!data) {
    return null
  }

  const statsGameId = readGameId(data.gameId)
  const rootReportGameId = readGameId(data.reportGameId)
  const teams = Array.isArray(data.teams)
    ? data.teams.map(asRecord).filter((team): team is UnknownRecord => team !== null)
    : []
  if (!statsGameId || teams.length < 2) {
    return null
  }

  const localPlayer = asRecord(data.localPlayer)
  const markedLocalPlayers = teams
    .flatMap((team) => (Array.isArray(team.players) ? team.players : []))
    .map(asRecord)
    .filter((player): player is UnknownRecord => player?.isLocalPlayer === true)
  const markedLocalPuuids = new Set(
    markedLocalPlayers.map(getPlayerPuuid).filter((puuid): puuid is string => Boolean(puuid))
  )
  if (markedLocalPuuids.size > 1) {
    return null
  }
  const markedLocalPuuid = markedLocalPuuids.values().next().value as string | undefined
  const rootLocalPuuid = localPlayer ? getPlayerPuuid(localPlayer) : undefined
  const localIdentityPuuids = new Set(
    [rootLocalPuuid, statePuuid, markedLocalPuuid].filter(
      (puuid): puuid is string => puuid !== undefined
    )
  )
  if (localIdentityPuuids.size > 1) {
    return null
  }
  const localPuuid = localIdentityPuuids.values().next().value as string | undefined
  if (!localPuuid) {
    return null
  }

  const flaggedTeamIndices = teams.flatMap((team, index) =>
    team.isPlayerTeam === true ? [index] : []
  )
  const identityTeamIndices = teams.flatMap((team, index) => {
    const players = Array.isArray(team.players) ? team.players : []
    return players.some((value) => {
      const player = asRecord(value)
      return player !== null && getPlayerPuuid(player) === localPuuid
    })
      ? [index]
      : []
  })
  if (flaggedTeamIndices.length > 1 || identityTeamIndices.length !== 1) {
    return null
  }
  if (
    flaggedTeamIndices.length === 1 &&
    identityTeamIndices.length === 1 &&
    flaggedTeamIndices[0] !== identityTeamIndices[0]
  ) {
    return null
  }
  const playerTeamIndex = identityTeamIndices[0]

  const puuidTeamIndices = new Map<string, number>()
  const puuidSummonerIds = new Map<string, number>()
  const summonerIdPuuids = new Map<number, string>()
  const puuidObfuscatedIds = new Map<string, string>()
  const obfuscatedIdPuuids = new Map<string, string>()
  for (const [teamIndex, team] of teams.entries()) {
    const players = Array.isArray(team.players) ? team.players : []
    for (const value of players) {
      const player = asRecord(value)
      if (!player || player.botPlayer === true || player.isBot === true) {
        continue
      }
      const puuid = player && getPlayerPuuid(player)
      if (!puuid) {
        continue
      }
      const previousTeamIndex = puuidTeamIndices.get(puuid)
      if (previousTeamIndex !== undefined && previousTeamIndex !== teamIndex) {
        return null
      }
      puuidTeamIndices.set(puuid, teamIndex)

      const summonerId = getSummonerId(player)
      if (summonerId) {
        const previousSummonerId = puuidSummonerIds.get(puuid)
        const previousPuuid = summonerIdPuuids.get(summonerId)
        if (
          (previousSummonerId !== undefined && previousSummonerId !== summonerId) ||
          (previousPuuid !== undefined && previousPuuid !== puuid)
        ) {
          return null
        }
        puuidSummonerIds.set(puuid, summonerId)
        summonerIdPuuids.set(summonerId, puuid)
      }

      const obfuscatedPuuid = getObfuscatedPuuid(player)
      if (obfuscatedPuuid) {
        const previousObfuscatedPuuid = puuidObfuscatedIds.get(puuid)
        const previousPuuid = obfuscatedIdPuuids.get(obfuscatedPuuid)
        if (
          (previousObfuscatedPuuid !== undefined && previousObfuscatedPuuid !== obfuscatedPuuid) ||
          (previousPuuid !== undefined && previousPuuid !== puuid)
        ) {
          return null
        }
        puuidObfuscatedIds.set(puuid, obfuscatedPuuid)
        obfuscatedIdPuuids.set(obfuscatedPuuid, puuid)
      }
    }
  }

  const targets: ReportTarget[] = []
  const seen = new Set<string>()
  const playerGameIds = new Set<number>()

  teams.forEach((team, teamIndex) => {
    const players = Array.isArray(team.players) ? team.players : []
    const side: ReportSide = teamIndex === playerTeamIndex ? 'ally' : 'opponent'

    for (const value of players) {
      const player = asRecord(value)
      if (!player || player.botPlayer === true || player.isBot === true) {
        continue
      }

      const playerGameId = readGameId(player.gameId)
      if (playerGameId) {
        playerGameIds.add(playerGameId)
      }

      const puuid = getPlayerPuuid(player)
      const summonerId = getSummonerId(player)
      if (
        !puuid ||
        !summonerId ||
        seen.has(puuid) ||
        player.isLocalPlayer === true ||
        (localPuuid !== undefined && puuid === localPuuid)
      ) {
        continue
      }

      const riotIdGameName = readString(player.riotIdGameName)
      const riotIdTagLine = readString(player.riotIdTagLine)
      const riotId = riotIdGameName
        ? `${riotIdGameName}${riotIdTagLine ? `#${riotIdTagLine}` : ''}`
        : undefined
      const obfuscatedPuuid = getObfuscatedPuuid(player)

      targets.push({
        puuid,
        ...(obfuscatedPuuid ? { obfuscatedPuuid } : {}),
        summonerId,
        summonerName:
          readString(player.summonerName) ?? riotId ?? readString(player.championName) ?? 'unknown',
        side
      })
      seen.add(puuid)
    }
  })

  if (targets.length === 0 || playerGameIds.size > 1) {
    return null
  }

  const playerReportGameId = playerGameIds.values().next().value as number | undefined
  if (
    rootReportGameId !== null &&
    playerReportGameId !== undefined &&
    rootReportGameId !== playerReportGameId
  ) {
    return null
  }

  const reportGameId = rootReportGameId ?? playerReportGameId
  if (!reportGameId) {
    return null
  }
  return { statsGameId, reportGameId, targets, source: 'eog' }
}

export function isReportRosterForGame(
  roster: ReportRosterSnapshot,
  expectedGameIds: ExpectedReportGameIds
) {
  return (
    (expectedGameIds.statsGameId !== null || expectedGameIds.reportGameId !== null) &&
    (expectedGameIds.statsGameId === null || roster.statsGameId === expectedGameIds.statsGameId) &&
    (expectedGameIds.reportGameId === null || roster.reportGameId === expectedGameIds.reportGameId)
  )
}

export function chooseReportRoster(
  eog: ReportRosterSnapshot | null,
  expectedGameIds: ExpectedReportGameIds
): ReportRosterSnapshot | null {
  if (eog && isReportRosterForGame(eog, expectedGameIds)) {
    return eog
  }
  return null
}

export interface SelectReportTargetsOptions {
  scope: AutoReportScope
  excludedPuuids: ReadonlySet<string>
  alreadyReportedIds: ReadonlySet<string>
}

export function isTargetAlreadyReported(
  target: ReportTarget,
  alreadyReportedIds: ReadonlySet<string>
) {
  return (
    alreadyReportedIds.has(target.puuid) ||
    (target.obfuscatedPuuid !== undefined && alreadyReportedIds.has(target.obfuscatedPuuid)) ||
    (target.summonerId > 0 && alreadyReportedIds.has(String(target.summonerId)))
  )
}

export function selectReportTargets(
  roster: readonly ReportTarget[],
  options: SelectReportTargetsOptions
): ReportTarget[] {
  const seenPuuids = new Set<string>()
  const seenSummonerIds = new Set<number>()
  const seenObfuscatedPuuids = new Set<string>()

  return roster.filter((target) => {
    if (options.scope === 'opponents-only' && target.side !== 'opponent') {
      return false
    }
    if (
      !target.puuid ||
      options.excludedPuuids.has(target.puuid) ||
      seenPuuids.has(target.puuid) ||
      seenSummonerIds.has(target.summonerId) ||
      (target.obfuscatedPuuid !== undefined && seenObfuscatedPuuids.has(target.obfuscatedPuuid))
    ) {
      return false
    }
    if (isTargetAlreadyReported(target, options.alreadyReportedIds)) {
      return false
    }

    seenPuuids.add(target.puuid)
    seenSummonerIds.add(target.summonerId)
    if (target.obfuscatedPuuid) {
      seenObfuscatedPuuids.add(target.obfuscatedPuuid)
    }
    return true
  })
}

export function getMinimumRosterTargetCount(
  ballotTargetCount: number,
  sessionPlayerPuuids: readonly string[],
  localPuuid: string | undefined,
  configuredPlayerCount: number
) {
  const sessionPuuids = new Set(sessionPlayerPuuids.filter(Boolean))
  if (localPuuid) {
    sessionPuuids.delete(localPuuid)
  }
  const sessionTargetCount = localPuuid
    ? sessionPuuids.size
    : Math.max(0, sessionPuuids.size - (sessionPuuids.size > 0 ? 1 : 0))
  const configuredTargetCount =
    sessionPuuids.size === 0 && Number.isFinite(configuredPlayerCount) && configuredPlayerCount > 0
      ? Math.floor(configuredPlayerCount) - 1
      : 0

  return Math.max(0, ballotTargetCount, sessionTargetCount, configuredTargetCount)
}

export function buildReportPayload(
  gameId: number,
  target: ReportTarget,
  categories: readonly AutoReportCategory[]
) {
  return {
    gameId,
    offenderPuuid: target.puuid,
    offenderSummonerId: target.summonerId,
    categories: [...categories],
    comment: ''
  }
}

/** 自动举报已有显式重试与歧义处理，所有相关 GET/POST 都绕过全局 axios-retry。 */
export function buildNoRetryRequestConfig(
  signal: AbortSignal,
  timeout?: number
): AxiosRequestConfig {
  return { signal, ...(timeout !== undefined ? { timeout } : {}), 'axios-retry': { retries: 0 } }
}

export function getRemainingRequestTimeout(
  deadline: number,
  nowMs = Date.now(),
  maximumMs = 17_500
): number | null {
  const remaining = deadline - nowMs
  if (remaining <= 0) {
    return null
  }
  return Math.max(1, Math.min(maximumMs, remaining))
}

const DEFAULT_REPORT_RETRY_DELAY_MS = 350
const MAX_REPORT_RETRY_DELAY_MS = 30_000

export function getReportRetryDelay(retryAfter: unknown, nowMs = Date.now()): number | null {
  let requestedDelay = Number(retryAfter) * 1000
  if (
    retryAfter === null ||
    retryAfter === undefined ||
    retryAfter === '' ||
    !Number.isFinite(requestedDelay) ||
    requestedDelay < 0
  ) {
    requestedDelay =
      typeof retryAfter === 'string' && Number.isFinite(Date.parse(retryAfter))
        ? Math.max(0, Date.parse(retryAfter) - nowMs)
        : DEFAULT_REPORT_RETRY_DELAY_MS
  }

  const delay = Math.max(DEFAULT_REPORT_RETRY_DELAY_MS, requestedDelay)
  return delay <= MAX_REPORT_RETRY_DELAY_MS ? delay : null
}

export type ReportWindowState = 'ready' | 'wait' | 'left' | 'disabled'

export function classifyReportWindow(phase: string | null, enabled: boolean): ReportWindowState {
  if (!enabled) {
    return 'disabled'
  }
  if (phase === 'EndOfGame') {
    return 'ready'
  }
  if (phase === 'WaitingForStats' || phase === 'PreEndOfGame') {
    return 'wait'
  }
  return 'left'
}

export function shouldDelayPlayAgainForReport(
  phase: string | null,
  autoReportEnabled: boolean,
  isAutoReporting: boolean
) {
  return (
    autoReportEnabled &&
    isAutoReporting &&
    (phase === 'WaitingForStats' || phase === 'PreEndOfGame' || phase === 'EndOfGame')
  )
}

export function isRetryableReportStatus(status?: number) {
  return status === 425 || status === 429
}

export function isAmbiguousReportStatus(status?: number) {
  return status === undefined || status === 408 || status >= 500
}
