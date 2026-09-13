import type { OngoingGameProviderValue } from '@renderer-shared/providers/ongoing-game'
import { EMPTY_PUUID } from '@shared/constants/common'

import champions from './champions.json'
import records from './matchups.json'

export const LANE_POSITIONS = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'] as const
export type LanePosition = (typeof LANE_POSITIONS)[number]

export interface MatchupTip {
  championId: number
  opponentId: number
  positions: LanePosition[]
  points: string[]
  sourceId: string
}

export interface ConfirmedMatchup {
  gameId: number
  championId: number
  opponentId: number
  position: LanePosition
}

type MatchupContext = Pick<
  OngoingGameProviderValue,
  | 'queryStage'
  | 'draft'
  | 'teams'
  | 'championSelections'
  | 'positionAssignments'
  | 'selfPuuid'
  | 'isConnected'
  | 'isSpectating'
>

function positionOf(game: MatchupContext, puuid: string): LanePosition | null {
  const value = game.positionAssignments[puuid]?.position
  const position = typeof value === 'string' ? value.trim().toUpperCase() : null
  return LANE_POSITIONS.find((candidate) => candidate === position) ?? null
}

/** Only a complete live roster with one player in each position can select a tips badge.
 * Draft probabilities, role popularity and champion-name guesses are never used here.
 */
export function resolveConfirmedMatchup(
  game: MatchupContext,
  targetPuuid: string
): ConfirmedMatchup | null {
  if (
    !game.isConnected ||
    game.isSpectating ||
    game.draft ||
    game.queryStage.phase !== 'in-game' ||
    game.queryStage.gameInfo.gameMode !== 'CLASSIC' ||
    !Number.isSafeInteger(game.queryStage.gameInfo.gameId) ||
    game.queryStage.gameInfo.gameId <= 0 ||
    !game.selfPuuid ||
    game.selfPuuid === targetPuuid
  ) {
    return null
  }

  const teams = Object.values(game.teams)
  if (teams.length !== 2 || teams.some((team) => team.length !== 5)) return null
  const players = teams.flat()
  if (
    new Set(players).size !== 10 ||
    players.some(
      (puuid) =>
        !puuid ||
        puuid === EMPTY_PUUID ||
        !Number.isSafeInteger(game.championSelections[puuid]) ||
        game.championSelections[puuid] <= 0
    )
  ) {
    return null
  }

  // A duplicate/unknown position could mean an incomplete payload or a lane swap.
  if (teams.some((team) => new Set(team.map((puuid) => positionOf(game, puuid))).size !== 5)) {
    return null
  }
  if (players.some((puuid) => positionOf(game, puuid) === null)) return null
  const selfTeam = teams.find((team) => team.includes(game.selfPuuid!))
  const opponentTeam = teams.find((team) => team.includes(targetPuuid))
  if (!selfTeam || !opponentTeam || selfTeam === opponentTeam) return null

  const position = positionOf(game, game.selfPuuid)
  if (!position || position !== positionOf(game, targetPuuid)) return null
  const championId = game.championSelections[game.selfPuuid]
  if (championId === 238) return null // Zed remains exclusively on the existing Bz path.

  return {
    gameId: game.queryStage.gameInfo.gameId,
    championId,
    opponentId: game.championSelections[targetPuuid],
    position
  }
}

const tipIndex = new Map<string, MatchupTip>()
for (const record of records as MatchupTip[]) {
  for (const position of record.positions) {
    tipIndex.set(`${record.championId}:${record.opponentId}:${position}`, record)
  }
}

/** Direction and lane are part of the identity. Never fall back to the reverse matchup. */
export function findMatchupTip(matchup: ConfirmedMatchup): MatchupTip | null {
  return tipIndex.get(`${matchup.championId}:${matchup.opponentId}:${matchup.position}`) ?? null
}

const chineseNames = new Map(champions.map((champion) => [champion.id, champion.name]))
export function matchupChampionName(id: number): string {
  return chineseNames.get(id) ?? `英雄 ${id}`
}
