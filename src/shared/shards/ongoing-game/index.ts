import type { AggregatedAnalysis } from '@shared/data-adapter/analysis/player'
import type { AggregatedTeamAnalysis } from '@shared/data-adapter/analysis/team'
import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import type { ParsedRole } from '@shared/utils/ranked'

export * from './reload'
export * from './settings'

export interface OngoingGameDraftHistory {
  source: 'sgp' | 'lcu'
  queueId: 700 | 710
  scannedCount: number
  scanLimit: number
  data: LcuOrSgpGameSummary[]
}

export type OngoingGameDraftHistoryStatus = 'waiting' | 'loading' | 'loaded' | 'error'

export interface OngoingGameAnalysis {
  players: Record<string, AggregatedAnalysis>
  teams: Record<string, AggregatedTeamAnalysis>
}

export interface OngoingGameSimplifiedChampMastery {
  championId: number
  championLevel: number
  championPoints: number
  championSeasonMilestone: number
  highestGrade: string
  lastPlayTime: number
}

export interface OngoingGamePositionAssignment {
  position: string
  role: ParsedRole | null
  isAutofilled: boolean
}

export interface AdditionalResult {
  teams: Record<string, string[]>
  selections: Record<string, number>
  teamParticipantGroups: Record<string, number>
  spells: Record<string, { spell1Id: number; spell2Id: number }>
  positions: Record<string, OngoingGamePositionAssignment>
}

interface QueryStageGameInfo {
  queueId: number
  queueType: string
  gameMode: string
  gameId: number
}

export interface QueryStageChampSelect {
  phase: 'champ-select'
  gameInfo: QueryStageGameInfo
}

export interface QueryStageInGame {
  phase: 'in-game'
  gameInfo: QueryStageGameInfo
}

export interface QueryStageLobby {
  phase: 'lobby'
  gameInfo: {
    queueId: number
    queueType: string
  }
}

export interface QueryStageDraft {
  phase: 'draft'
  gameInfo: {
    queueId: number
    queueType: string
  }
}

export interface QueryStageUnavailable {
  phase: 'unavailable'
  gameInfo: null
}

export type QueryStage =
  | QueryStageChampSelect
  | QueryStageLobby
  | QueryStageInGame
  | QueryStageLobby
  | QueryStageUnavailable
  | QueryStageDraft

export interface DraftOptions {
  gameModeKind: 'cherry' | 'normal'
  queueId: number
  puuid: string | null
  teams: Record<string, string[]>
  championSelections: Record<string, number>
  positions: Record<
    string,
    {
      selected: string
      primary: string
      secondary: string
    }
  > | null
}
