import type { OpggChampionBuildData } from '@shared/types/opgg'
import { describe, expect, it } from 'vitest'

import {
  MATCHUP_SECTION_KEYS,
  buildMatchupOverlay,
  buildVerifiedMatchupOverlay,
  isPlausibleMatchupBuild,
  isTargetSpecificMatchupBuild,
  resolveComparableMatchupGames
} from './matchup-build'

/** 2026-08-30 实测：KR / Emerald+ / 16.17 / Gangplank(41) vs Gwen(887)。 */
function gangplankVsGwen(): OpggChampionBuildData {
  return {
    summary: { id: 41 },
    summoner_spells: [
      { ids: [4, 14], win: 44, play: 98, pick_rate: 0.8991 },
      { ids: [4, 12], win: 5, play: 9, pick_rate: 0.0826 }
    ],
    rune_pages: [
      {
        id: 8992,
        primary_page_id: 8200,
        secondary_page_id: 8000,
        play: 80,
        win: 38,
        pick_rate: 0.7339,
        builds: [
          {
            id: 8992,
            primary_page_id: 8200,
            primary_rune_ids: [8992, 8275, 8210, 8237],
            secondary_page_id: 8000,
            secondary_rune_ids: [8017, 9105],
            stat_mod_ids: [5008, 5008, 5011],
            play: 46,
            win: 23,
            pick_rate: 0.575
          }
        ]
      }
    ],
    runes: [],
    skill_masteries: [
      {
        ids: ['Q', 'E', 'W'],
        play: 74,
        win: 35,
        pick_rate: 1,
        builds: [
          {
            order: ['Q', 'E', 'Q', 'W', 'Q', 'R', 'Q', 'E', 'Q', 'E', 'R', 'E', 'E', 'W', 'W'],
            play: 23,
            win: 10,
            pick_rate: 0.3108
          }
        ]
      }
    ],
    skills: [],
    skill_evolves: [],
    starter_items: [
      { ids: [1055, 2003], play: 83, win: 37, pick_rate: 0.783 },
      { ids: [1086, 2003, 2003], play: 12, win: 7, pick_rate: 0.1132 }
    ],
    boots: [{ ids: [3008], play: 24, win: 11, pick_rate: 0.2609 }],
    core_items: [{ ids: [3508, 6676, 3031], play: 16, win: 7, pick_rate: 0.2424 }],
    last_items: [{ ids: [3508], play: 100, win: 45, pick_rate: 0.9524 }]
  } as unknown as OpggChampionBuildData
}

function scaleAllSectionStats(data: OpggChampionBuildData, factor: number) {
  const scale = (row: any) => {
    row.play *= factor
    row.win *= factor
  }
  const mutable = data as any
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
}

describe('OP.GG target-champion matchup overlay', () => {
  it('matches the live Gangplank vs Gwen target-JSON contract for all seven sections', () => {
    const { overlay, parsedSections } = buildMatchupOverlay(gangplankVsGwen())

    expect(parsedSections).toEqual(MATCHUP_SECTION_KEYS)
    expect(overlay.summoner_spells[0]).toMatchObject({
      ids: [4, 14],
      play: 98,
      win: 44,
      pick_rate: 0.8991
    })
    expect(overlay.runes[0]).toMatchObject({
      play: 80,
      win: 38,
      pick_rate: 0.7339,
      primary_rune_ids: [8992, 8275, 8210, 8237]
    })
    expect(overlay.skill_masteries[0]).toMatchObject({
      ids: ['Q', 'E', 'W'],
      play: 23,
      win: 10,
      pick_rate: 0.3108
    })
    expect(overlay.skill_masteries[0].builds[0].order).toEqual([
      'Q',
      'E',
      'Q',
      'W',
      'Q',
      'R',
      'Q',
      'E',
      'Q',
      'E',
      'R',
      'E',
      'E',
      'W',
      'W'
    ])
    expect(overlay.starter_items[1].ids).toEqual([1086, 2003, 2003])
    expect(overlay.last_items[0]).toMatchObject({
      ids: [3508],
      play: 100,
      win: 45,
      is_matchup_aggregate: true
    })
    expect(isPlausibleMatchupBuild(gangplankVsGwen(), 88)).toBe(true)
  })

  it('rejects a generic large-sample response if target_champion was ignored', () => {
    const generic = gangplankVsGwen()
    scaleAllSectionStats(generic, 100)

    expect(isPlausibleMatchupBuild(generic, 88)).toBe(false)
  })

  it('requires at least two target sections to differ from the no-target baseline', () => {
    const target = gangplankVsGwen()
    const generic = gangplankVsGwen()

    expect(isTargetSpecificMatchupBuild(target, generic, 88)).toBe(false)

    generic.summoner_spells![0] = {
      ids: [4, 14],
      play: 1641,
      win: 800,
      pick_rate: 0.9
    }
    expect(isTargetSpecificMatchupBuild(target, generic, 88)).toBe(false)

    generic.starter_items[0] = {
      ids: [1055, 2003],
      play: 1600,
      win: 790,
      pick_rate: 0.8
    }
    expect(isTargetSpecificMatchupBuild(target, generic, 88)).toBe(true)

    const verified = buildVerifiedMatchupOverlay(target, generic, 88)
    expect(verified.parsedSections).toEqual(['summoner_spells', 'starter_items'])
    expect(verified.overlay.summoner_spells).toHaveLength(2)
    expect(verified.overlay.starter_items).toHaveLength(2)
    expect(verified.overlay.runes).toEqual([])
    expect(verified.overlay.skill_masteries).toEqual([])
    expect(verified.overlay.boots).toEqual([])
    expect(verified.overlay.core_items).toEqual([])
    expect(verified.overlay.last_items).toEqual([])
  })

  it('accepts all seven sections when the same configurations come from a real segmented cohort', () => {
    const target = gangplankVsGwen()
    ;(target.skill_masteries as any[]).push({
      ids: ['E', 'Q', 'W'],
      play: 1,
      win: 0,
      pick_rate: 0.01,
      // 此处 pick_rate 的分母是该 mastery，不是全体；证明逻辑必须使用外层共同分母。
      builds: [{ order: ['E', 'Q', 'W'], play: 1, win: 0, pick_rate: 1 }]
    })
    const generic = structuredClone(target)
    scaleAllSectionStats(generic, 100)

    const verified = buildVerifiedMatchupOverlay(target, generic, 88)
    expect(verified.parsedSections).toEqual(MATCHUP_SECTION_KEYS)
    expect(isTargetSpecificMatchupBuild(target, generic, 88)).toBe(true)
  })

  it('rejects ignored-target cache drift even when the target cohort is superficially plausible', () => {
    const target = gangplankVsGwen()
    target.summoner_spells![0] = {
      ids: [4, 14],
      play: 432,
      win: 216,
      pick_rate: 0.9
    }
    target.starter_items[0] = {
      ids: [1055, 2003],
      play: 384,
      win: 192,
      pick_rate: 0.8
    }
    const generic = structuredClone(target)
    generic.summoner_spells![0].play += 1
    generic.starter_items[0].play += 1

    expect(isPlausibleMatchupBuild(target, 200)).toBe(true)
    expect(isTargetSpecificMatchupBuild(target, generic, 200)).toBe(false)
    expect(buildVerifiedMatchupOverlay(target, generic, 200).parsedSections).toEqual([])
  })

  it('requires target and baseline counter anchors to be from comparable snapshots', () => {
    expect(resolveComparableMatchupGames(1645, 1626)).toBe(1635.5)
    expect(resolveComparableMatchupGames(88, 100)).toBeNull()
    expect(resolveComparableMatchupGames(0, 0)).toBeNull()
  })

  it('writes empty arrays for missing target sections instead of retaining generic rows', () => {
    const sparse = gangplankVsGwen()
    sparse.last_items = []
    sparse.skill_masteries = []

    const { overlay, parsedSections } = buildMatchupOverlay(sparse)

    expect(overlay.last_items).toEqual([])
    expect(overlay.skill_masteries).toEqual([])
    expect(parsedSections).not.toContain('last_items')
    expect(parsedSections).not.toContain('skill_masteries')
  })

  it('drops malformed one-icon spell rows instead of reproducing the missing-spell bug', () => {
    const malformed = gangplankVsGwen()
    malformed.summoner_spells!.unshift({ ids: [4], play: 100, win: 50, pick_rate: 0.91 })

    expect(buildMatchupOverlay(malformed).overlay.summoner_spells.map((row) => row.ids)).toEqual([
      [4, 14],
      [4, 12]
    ])
  })

  it.each([null, undefined, 42, 'malformed', [], { skill_masteries: null }])(
    'turns a malformed top-level response into an explicit empty overlay (%j)',
    (malformed) => {
      const { overlay, parsedSections } = buildMatchupOverlay(malformed)

      expect(parsedSections).toEqual([])
      expect(overlay).toEqual({
        summoner_spells: [],
        runes: [],
        skill_masteries: [],
        starter_items: [],
        boots: [],
        core_items: [],
        last_items: [],
        prism_items: []
      })
      expect(isPlausibleMatchupBuild(malformed, 88)).toBe(false)
    }
  )

  it.each([null, 'not-an-array', {}, [null, { ids: null, builds: null }]])(
    'filters a malformed skill_masteries collection without throwing (%j)',
    (skillMasteries) => {
      expect(
        buildMatchupOverlay({ skill_masteries: skillMasteries }).overlay.skill_masteries
      ).toEqual([])
    }
  )

  it('filters malformed skill ids, builds and orders before the UI can call startsWith', () => {
    const validBuild = {
      order: ['Q', 'E', 'Q', 'W', 'R'],
      play: 23,
      win: 10,
      pick_rate: 0.31
    }
    const malformed = {
      skill_masteries: [
        null,
        { ids: 'QEW', builds: [validBuild] },
        { ids: ['Q', null, 'W'], builds: [validBuild] },
        { ids: ['Q', 'E', 'W'], builds: null },
        { ids: ['Q', 'E', 'W'], builds: {} },
        {
          ids: ['Q', 'E', 'W'],
          builds: [
            null,
            { ...validBuild, ids: null },
            { ...validBuild, order: 'QEQWR' },
            { ...validBuild, order: ['Q', 7, 'W'] },
            { ...validBuild, order: { 0: 'Q' } },
            validBuild
          ]
        }
      ]
    }

    const skills = buildMatchupOverlay(malformed).overlay.skill_masteries

    expect(skills).toHaveLength(1)
    expect(skills[0]).toMatchObject({
      ids: ['Q', 'E', 'W'],
      play: 23,
      win: 10,
      pick_rate: 0.31
    })
    expect(skills[0].builds).toHaveLength(1)
    expect(skills[0].builds[0].order).toEqual(['Q', 'E', 'Q', 'W', 'R'])

    const allSkillKeys = skills.flatMap((mastery) => [
      ...mastery.ids,
      ...mastery.builds.flatMap((build) => build.order ?? [])
    ])
    expect(allSkillKeys.every((skill) => typeof skill === 'string')).toBe(true)
    expect(() => allSkillKeys.forEach((skill) => skill.startsWith('R-'))).not.toThrow()
  })

  it('keeps only validated rune and item arrays and strips malformed optional orders', () => {
    const { overlay } = buildMatchupOverlay({
      summoner_spells: { ids: [4, 14], play: 10, win: 5, pick_rate: 1 },
      rune_pages: [
        null,
        { play: 10, win: 5, pick_rate: 1, builds: null },
        {
          play: 10,
          win: 5,
          pick_rate: 1,
          builds: [
            {
              id: 8992,
              primary_page_id: 8200,
              primary_rune_ids: null,
              secondary_page_id: 8000,
              secondary_rune_ids: [8017, 9105],
              stat_mod_ids: [5008, 5008, 5011],
              play: 10,
              win: 5,
              pick_rate: 1
            }
          ]
        }
      ],
      runes: [
        null,
        {
          id: 8992,
          primary_page_id: 8200,
          primary_rune_ids: [8992, 8275, 8210, 8237],
          secondary_page_id: 8000,
          secondary_rune_ids: [8017, 9105],
          stat_mod_ids: [5008, 5008, 5011],
          play: 10,
          win: 5,
          pick_rate: 1
        }
      ],
      starter_items: [
        null,
        { ids: null, play: 10, win: 5, pick_rate: 1 },
        { ids: '1055,2003', play: 10, win: 5, pick_rate: 1 },
        { ids: [1055, '2003'], play: 10, win: 5, pick_rate: 1 },
        { ids: [1055, 2003], play: '10', win: 5, pick_rate: 1 },
        { ids: [1055, 2003], order: 'QEW', play: 10, win: 5, pick_rate: 1 }
      ],
      boots: 'not-an-array',
      core_items: {},
      last_items: null
    })

    expect(overlay.summoner_spells).toEqual([])
    expect(overlay.runes).toHaveLength(1)
    expect(overlay.runes[0].primary_rune_ids).toEqual([8992, 8275, 8210, 8237])
    expect(overlay.starter_items).toEqual([{ ids: [1055, 2003], play: 10, win: 5, pick_rate: 1 }])
    expect(overlay.boots).toEqual([])
    expect(overlay.core_items).toEqual([])
    expect(overlay.last_items).toEqual([])
  })

  it('ignores malformed cohort rows during plausibility checks', () => {
    const malformed = {
      summoner_spells: [null, { play: '98', win: 44, pick_rate: 0.9 }],
      rune_pages: {},
      skill_masteries: 'not-an-array',
      starter_items: [{ play: 83, win: null, pick_rate: 0.78 }],
      boots: null,
      core_items: [undefined],
      last_items: [{ play: 10, win: 5, pick_rate: Number.NaN }]
    }

    expect(isPlausibleMatchupBuild(malformed, 88)).toBe(false)
  })
})
