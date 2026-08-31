import { describe, expect, it } from 'vitest'

import { mergeBzIntoOverlay } from './bz-overlay'

describe('mergeBzIntoOverlay', () => {
  it('promotes multiple core builds in source order and marks only synthesized rows', () => {
    const overlay = {
      core_items: [
        { ids: [6692, 3142], play: 25, win: 14, pick_rate: 0.2 },
        { ids: [3071, 6694], play: 10, win: 6, pick_rate: 0.1 }
      ]
    }
    const before = structuredClone(overlay)
    const recommendation = {
      coreItemBuilds: [
        [6692, 3142],
        [3142, 3814],
        [6692, 3142]
      ],
      coreItemIds: [3142, 3814]
    }
    const recommendationBefore = structuredClone(recommendation)

    const result = mergeBzIntoOverlay(overlay, recommendation, null)

    expect(result.sections).toEqual(['core_items'])
    expect(result.overlay?.core_items).toEqual([
      { ids: [6692, 3142], play: 25, win: 14, pick_rate: 0.2 },
      {
        ids: [3142, 3814],
        play: 0,
        win: 0,
        pick_rate: 0,
        is_bz_recommendation: true
      },
      { ids: [3071, 6694], play: 10, win: 6, pick_rate: 0.1 }
    ])
    expect(overlay).toEqual(before)
    expect(recommendation).toEqual(recommendationBefore)
  })

  it('moves matching spell, starter and core rows to the front without replacing statistics', () => {
    const overlay = {
      summoner_spells: [
        { ids: [4, 12], play: 100, win: 50, pick_rate: 0.5 },
        { ids: [14, 4], play: 60, win: 36, pick_rate: 0.3 }
      ],
      starter_items: [
        { ids: [1054], play: 80, win: 40, pick_rate: 0.4 },
        { ids: [1055], play: 70, win: 42, pick_rate: 0.35 }
      ],
      core_items: [
        { ids: [3071, 6694], play: 40, win: 20, pick_rate: 0.2 },
        { ids: [6692, 3142], play: 30, win: 18, pick_rate: 0.15 }
      ]
    }

    const result = mergeBzIntoOverlay(
      overlay,
      { coreItemBuilds: [[6692, 3142]] },
      { spellIds: [4, 14], starterItemId: 1055 }
    )

    expect(result.sections).toEqual(['summoner_spells', 'starter_items', 'core_items'])
    expect(result.overlay?.summoner_spells).toEqual([
      { ids: [14, 4], play: 60, win: 36, pick_rate: 0.3 },
      { ids: [4, 12], play: 100, win: 50, pick_rate: 0.5 }
    ])
    expect(result.overlay?.starter_items).toEqual([
      { ids: [1055], play: 70, win: 42, pick_rate: 0.35 },
      { ids: [1054], play: 80, win: 40, pick_rate: 0.4 }
    ])
    expect(result.overlay?.core_items).toEqual([
      { ids: [6692, 3142], play: 30, win: 18, pick_rate: 0.15 },
      { ids: [3071, 6694], play: 40, win: 20, pick_rate: 0.2 }
    ])
    for (const section of ['summoner_spells', 'starter_items', 'core_items'] as const) {
      expect(result.overlay?.[section]).not.toContainEqual(
        expect.objectContaining({ is_bz_recommendation: true })
      )
    }
  })

  it('deduplicates an existing recommended row when promoting it', () => {
    const overlay = {
      core_items: [
        { ids: [3071, 6694], play: 40, win: 20, pick_rate: 0.2 },
        { ids: [6692, 3142], play: 30, win: 18, pick_rate: 0.15 },
        { ids: [6692, 3142], play: 20, win: 11, pick_rate: 0.1 }
      ]
    }

    const result = mergeBzIntoOverlay(overlay, { coreItemBuilds: [[6692, 3142]] }, null)

    expect(result.overlay?.core_items).toEqual([
      { ids: [6692, 3142], play: 30, win: 18, pick_rate: 0.15 },
      { ids: [3071, 6694], play: 40, win: 20, pick_rate: 0.2 }
    ])
  })

  it('resolves the handwritten spell and starter recommendations from the champion name', () => {
    const result = mergeBzIntoOverlay(null, { champion: 'Ahri' })

    expect(result.sections).toEqual(['summoner_spells', 'starter_items'])
    expect(result.overlay).toMatchObject({
      summoner_spells: [
        {
          ids: [4, 14],
          is_bz_recommendation: true
        }
      ],
      starter_items: [
        {
          ids: [1055],
          is_bz_recommendation: true
        }
      ]
    })
    // BZ-only 也必须显式清空其余对位区块，不能让浅合并残留通用数据。
    expect(result.overlay).toMatchObject({
      runes: [],
      skill_masteries: [],
      boots: [],
      last_items: [],
      prism_items: []
    })
  })

  it('reports a filtered rune section only when at least one page is removed', () => {
    const matching = {
      primary_rune_ids: [8112, 8143],
      play: 20,
      win: 12,
      pick_rate: 0.2
    }
    const other = {
      primary_rune_ids: [8369, 8304],
      play: 30,
      win: 14,
      pick_rate: 0.3
    }
    const overlay = { runes: [matching, other] }

    const result = mergeBzIntoOverlay(overlay, { keystonePerkId: 8112 }, null)

    expect(result.runeFilterStatus).toBe('filtered')
    expect(result.sections).toEqual(['runes'])
    expect(result.overlay?.runes).toEqual([matching])
    expect(overlay.runes).toEqual([matching, other])
  })

  it('distinguishes already-matching, unmatched and missing rune data', () => {
    const page = { primary_rune_ids: [8112, 8143], play: 20, win: 12, pick_rate: 0.2 }

    expect(mergeBzIntoOverlay({ runes: [page] }, { keystonePerkId: 8112 }, null)).toMatchObject({
      sections: [],
      runeFilterStatus: 'already-matched'
    })
    expect(mergeBzIntoOverlay({ runes: [page] }, { keystonePerkId: 8369 }, null)).toMatchObject({
      sections: [],
      runeFilterStatus: 'no-match'
    })
    expect(mergeBzIntoOverlay({}, { keystonePerkId: 8112 }, null)).toMatchObject({
      sections: [],
      runeFilterStatus: 'missing-runes'
    })
  })

  it('returns null when a recommendation cannot add anything to a null overlay', () => {
    expect(mergeBzIntoOverlay(null, { coreItemBuilds: [[]], keystonePerkId: 8112 }, null)).toEqual({
      overlay: null,
      sections: [],
      runeFilterStatus: 'missing-runes'
    })
  })
})
