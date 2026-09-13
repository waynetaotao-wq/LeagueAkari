import type { MatchupBuildResult, RolePriors } from '@shared/types/counter-intel'

// Deliberate draft scenarios, not measured champion statistics.
export const draftPriors: RolePriors = {
  22: { bottom: 0.97, middle: 0.01, utility: 0.02 },
  41: { top: 0.55, middle: 0.45 },
  86: { top: 0.995, middle: 0.005 },
  64: { jungle: 1 },
  89: { utility: 1 }
}

export function draftSession(ids: number[], gameId = 101) {
  return {
    id: `draft-${gameId}`,
    gameId,
    localPlayerCellId: 0,
    actions: [],
    myTeam: [{ cellId: 0, championId: 238, assignedPosition: 'middle' }],
    theirTeam: Array.from({ length: 5 }, (_, index) => ({
      cellId: index + 5,
      championId: ids[index] ?? 0,
      championPickIntent: 0,
      assignedPosition: ''
    }))
  }
}

export function draftBuild(query: {
  myChampionId: number
  opponentChampionId: number
  position: 'middle'
  region: 'kr'
  tier: 'emerald_plus'
  version: string | null
}): MatchupBuildResult {
  const pick = (ids: number[]) => ({ ids, play: 10, win: 5, pick_rate: 1 })
  const overlay = {
    summoner_spells: [pick([4, 14])],
    runes: [
      {
        ...pick([8112]),
        primary_page_id: 8100,
        primary_rune_ids: [8112, 8139, 8143, 8106],
        secondary_page_id: 8200,
        secondary_rune_ids: [8226, 8210],
        stat_mod_ids: [5008, 5008, 5011]
      }
    ],
    skill_masteries: [pick([1, 3, 2])],
    starter_items: [pick([1055, 2003])],
    boots: [pick([3158])],
    core_items: [pick([3142])],
    last_items: [pick([6694])]
  }
  return {
    ...query,
    sourceVersion: '16.18',
    targetVerified: true,
    overlay,
    parsedSections: Object.keys(overlay),
    meta: { play: 10, win: 5 },
    updatedAt: new Date().toISOString()
  }
}
