// [lolps] 复盘仅展示服务端证据；缺失数值必须保持 null。
export type ReviewPosition = 'TOP' | 'JUNGLE' | 'MIDDLE' | 'BOTTOM' | 'UTILITY' | 'UNKNOWN'

export interface ReviewParticipant {
  participantId: number
  puuid: string
  championId: number
  championName: string
  name: string
  teamId: 100 | 200
  position: ReviewPosition
  win: boolean
}

export interface ReviewPoint {
  x: number
  y: number
}

export interface ReviewParticipantFrame {
  participantId: number
  gold: number | null
  cs: number | null
  position: ReviewPoint | null
  level: number | null
  alive: boolean | null
}

export interface ReviewFrame {
  timestamp: number
  participants: ReviewParticipantFrame[]
  personalGoldDiff: number | null
  personalCsDiff: number | null
  teamGoldDiff: number | null
}

export interface ReviewEvent {
  id: string
  timestamp: number
  type: 'kill' | 'building' | 'monster'
  killerId: number | null
  victimId: number | null
  assistingParticipantIds: number[]
  /** Team receiving the kill/objective; never the destroyed building's team. */
  teamId: 100 | 200 | null
  position: ReviewPoint | null
  shutdownBounty: number | null
  buildingType: string | null
  laneType: string | null
  monsterType: string | null
  monsterSubType: string | null
}

export interface ReviewSnapshot {
  minute: 10 | 15 | 20
  /** Actual sampled timestamp, at most 10 seconds from the requested minute. */
  timestamp: number | null
  personalGoldDiff: number | null
  personalCsDiff: number | null
  teamGoldDiff: number | null
}

export interface ReviewMoment {
  id: string
  kind: 'gold-swing' | 'gold-gain' | 'shutdown' | 'repeated-deaths' | 'death-objective'
  title: string
  description: string
  start: number
  end: number
  eventIds: string[]
  scope: 'personal' | 'team' | null
  before: number | null
  after: number | null
}

export interface ReviewQuality {
  expectedFrames: number
  missingFrames: number
  timelineCoverage: number
  validGoldSnapshots: number
  validCsSnapshots: number
  validTeamSnapshots: number
  eventCoverage: 'complete' | 'partial'
  warnings: string[]
}

/** An enemy champion credited with a kill or an assist on the reviewed player. */
export interface ReviewDeathSource {
  championId: number
  role: ReviewPosition
}

/** One recorded death of the reviewed player. */
export interface ReviewDeath {
  timestamp: number
  /** Coordinates recorded with the kill event itself; never taken from a minute snapshot. */
  point: ReviewPoint | null
  /** Null when a turret, minion or monster dealt the killing blow. */
  killer: ReviewDeathSource | null
  assists: ReviewDeathSource[]
  shutdownBounty: number | null
}

/**
 * Early-game measurements used to compare wins with losses. Each field stays null when the
 * game is too short, the role does not apply or the timeline cannot prove the value.
 */
export interface ReviewEarlyFacts {
  /** Own creep score in the 10-minute snapshot. */
  cs10: number | null
  deathsBefore10: number | null
  /** Deaths before 14:00 to exactly one enemy champion. */
  soloDeathsBefore14: number | null
  /** Deaths before 14:00 credited to the enemy jungler as killer or assistant. */
  jungleDeathsBefore14: number | null
  /** Own kills plus assists before 14:00. */
  takedownsBefore14: number | null
  wardsBefore10: number | null
  controlWardsBefore15: number | null
  /** First purchase after 2:00, i.e. the first time back at the shop. */
  firstShopAt: number | null
  firstCoreItemAt: number | null
  firstCoreItemId: number | null
  /** Plates of the own lane's enemy turrets destroyed before 14:00. */
  platesTaken: number | null
  /** Plates of the own lane's allied turrets destroyed before 14:00. */
  platesLost: number | null
  /** Mid lane only: separate visits to a side-lane corridor before 14:00, from minute snapshots. */
  roamsBefore14: number | null
}

export interface ReviewMatch {
  meta: {
    gameId: number
    sgpServerId: string
    puuid: string
    gameCreation: number
    gameDuration: number
    queueId: number
    patch: string
    championId: number
    position: ReviewPosition
    participantId: number
    teamId: 100 | 200
    opponentId: number | null
    opponentChampionId: number | null
    win: boolean
  }
  participants: ReviewParticipant[]
  frames: ReviewFrame[]
  events: ReviewEvent[]
  moments: ReviewMoment[]
  snapshots: ReviewSnapshot[]
  quality: ReviewQuality
  /** Own deaths with coordinates. Missing in archives saved before the death map existed. */
  deaths?: ReviewDeath[] | null
  /** Missing in archives saved before the win/loss comparison existed. */
  early?: ReviewEarlyFacts | null
}

export type ReviewParseResult = { ok: true; match: ReviewMatch } | { ok: false; reason: string }

export interface ReviewFilter {
  championId?: number | null
  position?: ReviewPosition | null
  opponentChampionId?: number | null
  patch?: string | null
  queueId?: number | null
}

export interface ReviewMetric {
  mean: number | null
  samples: number
  min: number | null
  max: number | null
  /** Sample standard deviation; null below two observations. */
  standardDeviation: number | null
}

export interface ReviewSampleStats {
  games: number
  wins: number
  winRate: number | null
  gold10: ReviewMetric
  gold15: ReviewMetric
  cs10: ReviewMetric
  cs15: ReviewMetric
  teamGold10: ReviewMetric
  teamGold15: ReviewMetric
}

export interface ReviewMatchupGroup extends ReviewSampleStats {
  championId: number
  position: ReviewPosition
  opponentChampionId: number | null
  matches: ReviewMatch[]
}

export interface ReviewTrend {
  /** Disjoint groups with equal game counts, each at most 20. */
  recent: ReviewSampleStats
  previous: ReviewSampleStats
  recentMatches: ReviewMatch[]
  previousMatches: ReviewMatch[]
}

export interface ReviewConversionEntry {
  match: ReviewMatch
  /** Earliest qualified 10/15-minute checkpoint. */
  checkpoint: 10 | 15
  personalLead: boolean
  teamLead: boolean
  snapshots: ReviewSnapshot[]
  deaths: ReviewEvent[]
  enemyObjectives: ReviewEvent[]
}

export interface ReviewConversionStats {
  games: number
  wins: number
  winRate: number | null
  eligibleGames: number
  excludedGames: number
  entries: ReviewConversionEntry[]
}

export interface ReviewConversionOptions {
  checkpoint?: 10 | 15 | 'either'
  scope?: 'personal' | 'team' | 'either'
  outcome?: 'all' | 'win' | 'loss'
}
