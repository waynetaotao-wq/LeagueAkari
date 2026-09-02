import type { OpggChampionBuildData } from '@shared/types/opgg'
import { describe, expect, it } from 'vitest'

import {
  MIN_UNANCHORED_MATCHUP_GAMES,
  buildVerifiedMatchupOverlay,
  estimateUnanchoredMatchup,
  isPlausibleMatchupBuild
} from './matchup-build'

/**
 * 实测形状（2026-09-01 船长 vs 艾克 · 上 · KR · 翡翠+ · 16.17）：对手不在 OP.GG 的
 * counters 前 60 名里，各区母体约 13 场，而通用母体 1 万+。
 */
function rareMatchup(): OpggChampionBuildData {
  return {
    summary: { id: 41 },
    summoner_spells: [
      { ids: [4, 14], play: 11, win: 5, pick_rate: 0.8462 },
      { ids: [4, 12], play: 2, win: 1, pick_rate: 0.1538 }
    ],
    rune_pages: [
      {
        id: 8992,
        primary_page_id: 8200,
        secondary_page_id: 8000,
        play: 9,
        win: 4,
        pick_rate: 0.6923,
        builds: [
          {
            id: 8992,
            primary_page_id: 8200,
            primary_rune_ids: [8992, 8275, 8210, 8237],
            secondary_page_id: 8000,
            secondary_rune_ids: [8017, 9105],
            stat_mod_ids: [5008, 5008, 5011],
            play: 5,
            win: 2,
            pick_rate: 0.5556
          }
        ]
      }
    ],
    runes: [],
    skill_masteries: [
      {
        ids: ['Q', 'E', 'W'],
        play: 8,
        win: 4,
        pick_rate: 1,
        builds: [
          {
            order: ['Q', 'E', 'Q', 'W', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W'],
            play: 3,
            win: 1,
            pick_rate: 0.375
          }
        ]
      }
    ],
    skills: [],
    skill_evolves: [],
    starter_items: [{ ids: [1055, 2003], play: 12, win: 6, pick_rate: 0.9231 }],
    boots: [{ ids: [3008], play: 4, win: 2, pick_rate: 0.4444 }],
    core_items: [{ ids: [3508, 6676, 3031], play: 3, win: 2, pick_rate: 1 }],
    last_items: [{ ids: [3508], play: 10, win: 5, pick_rate: 0.9091 }]
  } as unknown as OpggChampionBuildData
}

function scaled(data: OpggChampionBuildData, factor: number) {
  const mutable = data as any
  const scale = (row: any) => {
    row.play = Math.round(row.play * factor)
    row.win = Math.round(row.win * factor)
  }
  for (const key of ['summoner_spells', 'starter_items', 'boots', 'core_items', 'last_items']) {
    mutable[key].forEach(scale)
  }
  mutable.rune_pages.forEach((page: any) => {
    scale(page)
    page.builds.forEach(scale)
  })
  mutable.skill_masteries.forEach((mastery: any) => {
    scale(mastery)
    mastery.builds.forEach(scale)
  })
  return data
}

describe('unanchored matchup verification (opponent missing from counters)', () => {
  it('accepts a rare matchup whose section cohorts agree with each other and shrink vs generic', () => {
    const target = rareMatchup()
    const generic = scaled(rareMatchup(), 1200)
    const estimate = estimateUnanchoredMatchup(target, generic)
    expect(estimate).not.toBeNull()
    expect(estimate!.games).toBeGreaterThanOrEqual(MIN_UNANCHORED_MATCHUP_GAMES)
    expect(estimate!.games).toBeLessThan(40)
    // 召唤师技能行划分整个母体：11+2 场 / 5+1 胜
    expect(estimate!.meta).toEqual({ play: 13, win: 6 })

    expect(isPlausibleMatchupBuild(target, estimate!.games)).toBe(true)
    const built = buildVerifiedMatchupOverlay(target, generic, estimate!.games)
    expect(built.parsedSections.length).toBeGreaterThanOrEqual(2)
    expect(built.overlay.summoner_spells[0]).toMatchObject({ ids: [4, 14], play: 11 })
  })

  it('rejects when the server ignored target_champion (target ≈ generic)', () => {
    const generic = scaled(rareMatchup(), 1200)
    const ignored = scaled(rareMatchup(), 1200)
    expect(estimateUnanchoredMatchup(ignored, generic)).toBeNull()
  })

  it('rejects a cache-drift lookalike (target only a few games smaller than generic)', () => {
    const generic = scaled(rareMatchup(), 1200)
    const drift = scaled(rareMatchup(), 1195)
    expect(estimateUnanchoredMatchup(drift, generic)).toBeNull()
  })

  it('rejects samples below the minimum and single-section responses', () => {
    const tiny = scaled(rareMatchup(), 0.2) // 母体 ≈ 2-3 场
    const generic = scaled(rareMatchup(), 1200)
    expect(estimateUnanchoredMatchup(tiny, generic)).toBeNull()

    const single = rareMatchup() as any
    for (const key of ['rune_pages', 'skill_masteries', 'starter_items', 'boots', 'core_items', 'last_items']) {
      single[key] = []
    }
    expect(estimateUnanchoredMatchup(single, generic)).toBeNull()
  })

  it('drops meta but still verifies when summoner spell rows are absent', () => {
    const target = rareMatchup() as any
    target.summoner_spells = []
    const generic = scaled(rareMatchup(), 1200)
    const estimate = estimateUnanchoredMatchup(target, generic)
    expect(estimate).not.toBeNull()
    expect(estimate!.meta).toBeNull()
  })
})
