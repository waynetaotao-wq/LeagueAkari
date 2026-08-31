import { describe, expect, it } from 'vitest'

import {
  type MatchupOverlayIdentity,
  applyMatchupOverlay,
  formatMatchupLoadoutSuffix,
  getMatchupLoadoutIdentity,
  hasCompleteMatchupLoadout,
  matchupLoadoutSourceSlug,
  matchupOverlay,
  matchupOverlayMeta,
  matchupRefreshGeneration,
  opggPositionToMatchupLane,
  requestMatchupRefresh,
  resolveMatchupLoadoutSource,
  setMatchupOverlay
} from './matchup-overlay'

const identity: MatchupOverlayIdentity = {
  gameId: 101,
  myChampionId: 238,
  opponentChampionId: 103,
  lane: 'middle',
  region: 'kr',
  tier: 'emerald_plus',
  version: '16.17',
  mode: 'ranked',
  source: 'opgg'
}

const baseChampion = {
  data: {
    summary: { id: 238 },
    core_items: [{ ids: [3142] }],
    runes: [{ id: 'general' }]
  },
  meta: { version: '16.16' }
}

const overlay = {
  core_items: [{ ids: [6692, 3142] }],
  runes: [{ id: 'matchup' }]
}

describe('applyMatchupOverlay', () => {
  it('merges the overlay only for the matching champion and known matchup fields', () => {
    const result = applyMatchupOverlay(baseChampion, overlay, identity, {
      opponentChampionId: 103,
      lane: 'middle',
      region: 'kr',
      tier: 'emerald_plus',
      version: '16.17',
      mode: 'ranked',
      source: 'opgg'
    })

    expect(result).not.toBe(baseChampion)
    expect(result?.data).toMatchObject({
      summary: { id: 238 },
      core_items: [{ ids: [6692, 3142] }],
      runes: [{ id: 'matchup' }]
    })
    expect(result?.meta).toBe(baseChampion.meta)
  })

  it('does not apply an old champion overlay to a newly loaded champion', () => {
    const nextChampion = {
      ...baseChampion,
      data: { ...baseChampion.data, summary: { id: 84 } }
    }

    expect(applyMatchupOverlay(nextChampion, overlay, identity)).toBe(nextChampion)
  })

  it('does not apply the overlay when a known opponent or lane changed', () => {
    expect(applyMatchupOverlay(baseChampion, overlay, identity, { opponentChampionId: 7 })).toBe(
      baseChampion
    )
    expect(applyMatchupOverlay(baseChampion, overlay, identity, { lane: 'top' })).toBe(baseChampion)
    expect(applyMatchupOverlay(baseChampion, overlay, identity, { lane: null })).toBe(baseChampion)
  })

  it.each([
    [{ gameId: 202 }, 'gameId'],
    [{ gameId: null }, 'inactive game'],
    [{ region: 'global' }, 'region'],
    [{ tier: 'all' }, 'tier'],
    [{ version: '16.16' }, 'version'],
    [{ mode: 'aram' }, 'mode'],
    [{ source: 'lolps' }, 'source']
  ] as const)('rejects a stale overlay when the %s context changed', (viewIdentity, _field) => {
    expect(applyMatchupOverlay(baseChampion, overlay, identity, viewIdentity)).toBe(baseChampion)
  })

  it('treats latest-version null as a real identity instead of an unknown wildcard', () => {
    expect(
      applyMatchupOverlay(baseChampion, overlay, { ...identity, version: null }, identity)
    ).toBe(baseChampion)
  })

  it('falls back to the champion guard when opponent identity is unavailable', () => {
    expect(applyMatchupOverlay(baseChampion, overlay, identity, { lane: 'middle' })).not.toBe(
      baseChampion
    )
  })

  it('does not apply an unbound overlay', () => {
    expect(applyMatchupOverlay(baseChampion, overlay, null)).toBe(baseChampion)
  })

  it('clears matchup metadata together with the patch', () => {
    setMatchupOverlay(overlay, '103 场', identity, {
      play: 103,
      win: 51,
      sourceVersion: '16.17'
    })
    expect(matchupOverlayMeta.value).toEqual({ play: 103, win: 51, sourceVersion: '16.17' })
    expect(getMatchupLoadoutIdentity(matchupOverlay.value)).toEqual({
      opponentChampionId: 103,
      source: 'OP.GG'
    })

    setMatchupOverlay(null)
    expect(matchupOverlayMeta.value).toBeNull()
    expect(getMatchupLoadoutIdentity(matchupOverlay.value)).toBeNull()
  })

  it('records honest OP.GG/BZ provenance even when BZ only filters or reorders real rows', () => {
    expect(resolveMatchupLoadoutSource(true, false)).toBe('OP.GG')
    expect(resolveMatchupLoadoutSource(true, true)).toBe('OP.GG+BZ')
    expect(resolveMatchupLoadoutSource(false, true)).toBe('BZ')
    expect(resolveMatchupLoadoutSource(false, false)).toBeNull()

    setMatchupOverlay(overlay, '', identity, null, 'OP.GG+BZ')
    expect(getMatchupLoadoutIdentity(matchupOverlay.value)).toEqual({
      opponentChampionId: 103,
      source: 'OP.GG+BZ'
    })

    setMatchupOverlay(overlay, '', identity, null, 'BZ')
    expect(getMatchupLoadoutIdentity(matchupOverlay.value)).toEqual({
      opponentChampionId: 103,
      source: 'BZ'
    })

    expect(formatMatchupLoadoutSuffix('阿狸', 'OP.GG+BZ')).toBe(' - vs 阿狸 · OP.GG+BZ')
    expect(matchupLoadoutSourceSlug('OP.GG')).toBe('opgg')
    expect(matchupLoadoutSourceSlug('OP.GG+BZ')).toBe('opgg-bz')
    expect(matchupLoadoutSourceSlug('BZ')).toBe('bz')
    setMatchupOverlay(null)
  })

  it.each([
    ['top', 'top'],
    ['jungle', 'jungle'],
    ['mid', 'middle'],
    ['adc', 'bottom'],
    ['support', 'utility'],
    ['all', null],
    ['none', null],
    [null, null]
  ] as const)('maps the base position %s to the guarded matchup lane', (position, lane) => {
    expect(opggPositionToMatchupLane(position)).toBe(lane)
  })

  it('rejects a top overlay after the original filter changes to mid', () => {
    const baseLane = opggPositionToMatchupLane('mid')
    expect(
      applyMatchupOverlay(baseChampion, overlay, { ...identity, lane: 'top' }, { lane: baseLane })
    ).toBe(baseChampion)
  })

  it('publishes explicit refresh generations for the matchup pipeline', () => {
    const before = matchupRefreshGeneration.value
    requestMatchupRefresh()
    expect(matchupRefreshGeneration.value).toBe(before + 1)
  })

  it('allows automatic client writes only for a complete matchup loadout', () => {
    const pick = (ids: number[]) => ({ ids, play: 10, win: 5, pick_rate: 1 })
    const complete = {
      summoner_spells: [pick([4, 14])],
      runes: [
        {
          ...pick([8992]),
          primary_page_id: 8200,
          primary_rune_ids: [8992, 8275, 8210, 8237],
          secondary_page_id: 8000,
          secondary_rune_ids: [8017, 9105],
          stat_mod_ids: [5008, 5008, 5011]
        }
      ],
      skill_masteries: [],
      starter_items: [pick([1055, 2003])],
      boots: [pick([3008])],
      core_items: [pick([3508, 6676, 3031])],
      last_items: [pick([3508])]
    }

    expect(hasCompleteMatchupLoadout(complete)).toBe(true)
    expect(hasCompleteMatchupLoadout({ ...complete, runes: [] })).toBe(false)
    expect(
      hasCompleteMatchupLoadout({
        ...complete,
        summoner_spells: [{}]
      })
    ).toBe(false)
    expect(
      hasCompleteMatchupLoadout({
        ...complete,
        starter_items: [{ ...pick([1055]), pick_rate: Number.NaN }]
      })
    ).toBe(false)
    expect(hasCompleteMatchupLoadout(null)).toBe(false)
  })
})
