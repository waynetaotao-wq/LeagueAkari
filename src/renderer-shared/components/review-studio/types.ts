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
  kind: 'gold-swing' | 'shutdown' | 'repeated-deaths' | 'death-objective'
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
