// [lolps] 上分日志：主进程与渲染进程共用的类型和纯逻辑。只记录本人账号的排位对局与胜点变化。

export const RANK_LOG_QUEUE_TYPES = ['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'] as const
export type RankLogQueueType = (typeof RANK_LOG_QUEUE_TYPES)[number]

/** Summoner's Rift ranked queues by queue id. */
export const RANK_LOG_QUEUE_IDS: Record<number, RankLogQueueType> = {
  420: 'RANKED_SOLO_5x5',
  440: 'RANKED_FLEX_SR'
}

export const RANK_LOG_QUERY_DEFAULT_LIMIT = 500
export const RANK_LOG_QUERY_MAX_LIMIT = 2000

/** 本机时钟与服务器对局结束时间之间允许的误差。 */
export const RANK_LOG_CLOCK_TOLERANCE_MS = 5 * 60_000

const TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND']
const APEX_TIERS = ['MASTER', 'GRANDMASTER', 'CHALLENGER']
const DIVISIONS = ['IV', 'III', 'II', 'I']
const LP_PER_DIVISION = 100
const LP_PER_TIER = LP_PER_DIVISION * DIVISIONS.length

/**
 * League points on one continuous scale, so a change across a division or tier is a plain
 * difference. 换算结果已与服务器的 cumulativeLp 实测核对一致（每个小段 100、每个大段 400）。
 * Master and above share one ladder that continues after Diamond I; that part follows the same
 * rule but has not been checked against a real apex account. null = unranked or unknown.
 */
export function toAbsoluteLp(tier: unknown, division: unknown, leaguePoints: unknown) {
  if (
    typeof tier !== 'string' ||
    typeof leaguePoints !== 'number' ||
    !Number.isFinite(leaguePoints) ||
    leaguePoints < 0
  )
    return null
  const name = tier.toUpperCase()
  if (APEX_TIERS.includes(name)) return TIERS.length * LP_PER_TIER + leaguePoints
  const tierIndex = TIERS.indexOf(name)
  const divisionIndex = DIVISIONS.indexOf(String(division).toUpperCase())
  if (tierIndex < 0 || divisionIndex < 0) return null
  return tierIndex * LP_PER_TIER + divisionIndex * LP_PER_DIVISION + leaguePoints
}

/**
 * The rank a value on the continuous scale stands for, for chart axes. Above Diamond I the scale
 * cannot tell Master, Grandmaster and Challenger apart, so everything there reads as Master.
 */
export function fromAbsoluteLp(absoluteLp: number) {
  const value = Math.max(0, Math.round(absoluteLp))
  const apexStart = TIERS.length * LP_PER_TIER
  if (value >= apexStart) {
    return { tier: APEX_TIERS[0], division: '', leaguePoints: value - apexStart }
  }
  return {
    tier: TIERS[Math.floor(value / LP_PER_TIER)],
    division: DIVISIONS[Math.floor((value % LP_PER_TIER) / LP_PER_DIVISION)],
    leaguePoints: value % LP_PER_DIVISION
  }
}

/** Whether a tier is one of the three that share the ladder above Diamond. */
export function isApexTier(tier: unknown) {
  return typeof tier === 'string' && APEX_TIERS.includes(tier.toUpperCase())
}

/** The ranked state of one queue at one moment. */
export interface RankSnapshot {
  queueType: RankLogQueueType
  /** Empty when the client reports no tier. */
  tier: string
  division: string
  leaguePoints: number
  wins: number
  losses: number
  /** Placement games are still running, so the visible rank is provisional. */
  provisional: boolean
  /** null while provisional or unranked: differences would be meaningless. */
  absoluteLp: number | null
}

const count = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null

/** Reads one queue entry of the client's ranked stats; null for other queues or broken data. */
export function readRankSnapshot(entry: unknown): RankSnapshot | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = entry as Record<string, unknown>
  const queueType = RANK_LOG_QUEUE_TYPES.find((type) => type === raw.queueType)
  const leaguePoints = count(raw.leaguePoints)
  const wins = count(raw.wins)
  const losses = count(raw.losses)
  if (!queueType || leaguePoints === null || wins === null || losses === null) return null
  const tier = typeof raw.tier === 'string' ? raw.tier.toUpperCase() : ''
  const division = typeof raw.division === 'string' ? raw.division.toUpperCase() : ''
  const provisional =
    raw.isProvisional === true ||
    (typeof raw.provisionalGamesRemaining === 'number' && raw.provisionalGamesRemaining > 0)
  return {
    queueType,
    tier,
    division,
    leaguePoints,
    wins,
    losses,
    provisional,
    absoluteLp: provisional ? null : toAbsoluteLp(tier, division, leaguePoints)
  }
}

/** Both ranked Rift queues out of the client's ranked stats, in a fixed order. */
export function readRankSnapshots(stats: unknown): RankSnapshot[] {
  const queues = (stats as { queues?: unknown } | null)?.queues
  if (!Array.isArray(queues)) return []
  return RANK_LOG_QUEUE_TYPES.flatMap((type) => {
    const snapshot = queues.map(readRankSnapshot).find((candidate) => candidate?.queueType === type)
    return snapshot ? [snapshot] : []
  })
}

export type RankChange =
  /** First observation, or the win/loss counters were reset by a new season or split. */
  | { kind: 'baseline' }
  /** Exactly one more game on the counters; its result follows from which counter moved. */
  | { kind: 'game'; win: boolean; lpDelta: number | null }
  /** Several games happened while nobody was watching; they cannot be told apart. */
  | { kind: 'gap'; games: number; lpDelta: number | null }
  /** The rank moved without a new game: a dodge penalty, decay or a correction. */
  | { kind: 'adjustment'; lpDelta: number | null }

/** What happened between two snapshots of the same queue; null when nothing changed. */
export function reconcileRankSnapshots(
  previous: Omit<RankSnapshot, 'queueType'> | null,
  current: Omit<RankSnapshot, 'queueType'>
): RankChange | null {
  if (!previous) return { kind: 'baseline' }
  const wins = current.wins - previous.wins
  const losses = current.losses - previous.losses
  // 任一计数变小都说明赛季或分段重置了，之前的数字不能再相减。
  if (wins < 0 || losses < 0) return { kind: 'baseline' }
  const games = wins + losses
  const lpDelta =
    previous.absoluteLp !== null && current.absoluteLp !== null
      ? current.absoluteLp - previous.absoluteLp
      : null
  if (games === 1) return { kind: 'game', win: wins === 1, lpDelta }
  if (games > 1) return { kind: 'gap', games, lpDelta }
  return previous.tier === current.tier &&
    previous.division === current.division &&
    previous.leaguePoints === current.leaguePoints &&
    previous.provisional === current.provisional
    ? null
    : { kind: 'adjustment', lpDelta }
}

export type RankLogEntryKind = 'game' | 'gap' | 'adjustment' | 'baseline'

/** One line of the rank log as the renderer receives it. */
export interface RankLogEntryDto {
  id: number
  kind: RankLogEntryKind
  queueType: RankLogQueueType
  /** Game end for identified games, otherwise the moment the change was seen. Epoch milliseconds. */
  occurredAt: number
  /** When the rank after this entry was read from the client; null when it never was. */
  observedAt: number | null
  gameId: number | null
  gameCreation: number | null
  /** Seconds. */
  gameDuration: number | null
  championId: number | null
  position: string | null
  win: boolean | null
  remake: boolean | null
  kills: number | null
  deaths: number | null
  assists: number | null
  cs: number | null
  /** Number of games a gap entry covers. */
  games: number | null
  lpDelta: number | null
  /** Rank after the entry; null when the change was not observed while it happened. */
  tier: string | null
  division: string | null
  leaguePoints: number | null
  absoluteLp: number | null
  provisional: boolean | null
  wins: number | null
  losses: number | null
}

export interface RankLogQueryDto {
  puuid: string
  sgpServerId: string
  queueType?: RankLogQueueType
  limit?: number
}

/** What a manual or automatic sync managed to read. */
export interface RankLogSyncResult {
  result: 'ok' | 'failed'
  /** Why nothing could be read; absent on success. */
  reason?: 'disabled' | 'unavailable' | 'not-connected' | 'rank-unreadable'
  /** Whether match history could be read this time. */
  historyLoaded: boolean
}

export function normalizeRankLogLimit(limit: unknown) {
  return typeof limit === 'number' && Number.isInteger(limit) && limit > 0
    ? Math.min(limit, RANK_LOG_QUERY_MAX_LIMIT)
    : RANK_LOG_QUERY_DEFAULT_LIMIT
}

/** A finished ranked game as read from match history. */
export interface RankLogGameFacts {
  gameId: number
  queueType: RankLogQueueType
  gameCreation: number
  /** Epoch milliseconds. */
  gameEnd: number
  /** Seconds. */
  gameDuration: number
  championId: number
  position: string
  win: boolean
  remake: boolean
  kills: number | null
  deaths: number | null
  assists: number | null
  cs: number | null
}

interface HistoryParticipant {
  puuid?: unknown
  championId?: unknown
  teamPosition?: unknown
  individualPosition?: unknown
  win?: unknown
  kills?: unknown
  deaths?: unknown
  assists?: unknown
  totalMinionsKilled?: unknown
  neutralMinionsKilled?: unknown
  gameEndedInEarlySurrender?: unknown
}

/** Picks the logged-in player's line out of one match-history summary; null when it is not a ranked Rift game of theirs. */
export function readRankLogGame(summary: unknown, puuid: string): RankLogGameFacts | null {
  const game = (summary as { json?: Record<string, unknown> } | null)?.json
  if (!game || typeof game !== 'object') return null
  const queueType = RANK_LOG_QUEUE_IDS[game.queueId as number]
  const gameId = game.gameId
  const creation = game.gameCreation
  const duration = game.gameDuration
  if (
    !queueType ||
    game.mapId !== 11 ||
    typeof gameId !== 'number' ||
    !Number.isSafeInteger(gameId) ||
    gameId <= 0 ||
    typeof creation !== 'number' ||
    !(creation > 0) ||
    typeof duration !== 'number' ||
    !(duration >= 0) ||
    !Array.isArray(game.participants)
  )
    return null
  const participants = game.participants as HistoryParticipant[]
  const own = participants.find((participant) => participant?.puuid === puuid)
  if (!own || typeof own.win !== 'boolean' || count(own.championId) === null) return null
  const lane = count(own.totalMinionsKilled)
  const jungle = count(own.neutralMinionsKilled)
  const position = [own.teamPosition, own.individualPosition].find(
    (value): value is string => typeof value === 'string' && value !== ''
  )
  const end = game.gameEndTimestamp
  return {
    gameId,
    queueType,
    gameCreation: creation,
    gameEnd: typeof end === 'number' && end > creation ? end : creation + duration * 1000,
    gameDuration: duration,
    championId: own.championId as number,
    position: position ?? '',
    win: own.win,
    // 重开的对局不计胜负，也不动胜点。
    remake:
      /abort|remake/i.test(String(game.endOfGameResult ?? '')) ||
      participants.some((participant) => participant?.gameEndedInEarlySurrender === true),
    kills: count(own.kills),
    deaths: count(own.deaths),
    assists: count(own.assists),
    cs: lane !== null && jungle !== null ? lane + jungle : null
  }
}

/** A ranked game the client is currently playing, as far as the gameflow session tells. */
export interface RankLogTrackedGame {
  gameId: number
  queueType: RankLogQueueType
}

/** Reads the running game out of the gameflow session; null unless the player is in a ranked Rift game. */
export function readRankLogTrackedGame(session: unknown, puuid: string): RankLogTrackedGame | null {
  const data = (session as { gameData?: Record<string, unknown> } | null)?.gameData
  if (!data || typeof data !== 'object' || data.isCustomGame === true) return null
  const gameId = data.gameId
  const queueType = RANK_LOG_QUEUE_IDS[(data.queue as { id?: number } | null)?.id as number]
  if (!queueType || typeof gameId !== 'number' || !Number.isSafeInteger(gameId) || gameId <= 0)
    return null
  const players = [data.teamOne, data.teamTwo].flatMap((team) => (Array.isArray(team) ? team : []))
  // 名单为空说明客户端还没把阵容填进来；有名单却没有自己，则是在看别人的对局。
  if (players.length && !players.some((player) => player?.puuid === puuid)) return null
  return { gameId, queueType }
}

/** A history game that has no rank change attached to it yet. */
export interface RankLogGameCandidate {
  gameId: number
  /** Epoch milliseconds. */
  gameEnd: number
  win: boolean
  remake: boolean
}

/**
 * The one history game a single-game rank change can belong to. The game has to end after the
 * previous rank was read and before this one, with the same result. null when no game or more
 * than one fits: 宁可留空，也不把胜点记到错的一局上。
 */
export function pickRankLogGame(
  candidates: readonly RankLogGameCandidate[],
  change: { after: number; before: number; win: boolean }
): RankLogGameCandidate | null {
  const fitting = candidates.filter(
    (candidate) =>
      !candidate.remake &&
      candidate.win === change.win &&
      candidate.gameEnd > change.after &&
      candidate.gameEnd <= change.before + RANK_LOG_CLOCK_TOLERANCE_MS
  )
  return fitting.length === 1 ? fitting[0] : null
}
