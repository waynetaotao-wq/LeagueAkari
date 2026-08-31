import { describe, expect, it } from 'vitest'

import { isBzLaneOpponent, resolveBzSelfPuuid } from './bz-summary-zh'

const teams = {
  'TEAM-100': ['self', 'ally'],
  'TEAM-200': ['enemy']
}

const baseInput = {
  teams,
  selfPuuid: 'self',
  targetPuuid: 'enemy',
  selfChampionId: 238,
  selfPosition: 'MIDDLE',
  targetPosition: 'MIDDLE'
}

describe('isBzLaneOpponent', () => {
  it('accepts only the same-position player on the enemy team', () => {
    expect(isBzLaneOpponent(baseInput)).toBe(true)
    expect(isBzLaneOpponent({ ...baseInput, targetPuuid: 'ally' })).toBe(false)
    expect(isBzLaneOpponent({ ...baseInput, targetPuuid: 'self' })).toBe(false)
    expect(isBzLaneOpponent({ ...baseInput, teams: {} })).toBe(false)
  })

  it('rejects NONE, empty, and different positions', () => {
    expect(isBzLaneOpponent({ ...baseInput, selfPosition: 'NONE' })).toBe(false)
    expect(isBzLaneOpponent({ ...baseInput, targetPosition: ' none ' })).toBe(false)
    expect(isBzLaneOpponent({ ...baseInput, targetPosition: '' })).toBe(false)
    expect(isBzLaneOpponent({ ...baseInput, targetPosition: 'TOP' })).toBe(false)
  })

  it('rejects the matchup when the observed player is not Zed', () => {
    expect(isBzLaneOpponent({ ...baseInput, selfChampionId: 1 })).toBe(false)
  })
})

describe('resolveBzSelfPuuid', () => {
  it('uses draft.puuid for observed matches and the live account outside draft mode', () => {
    expect(resolveBzSelfPuuid('draft-self', 'live-self')).toBe('draft-self')
    expect(resolveBzSelfPuuid(null, 'live-self')).toBeNull()
    expect(resolveBzSelfPuuid(undefined, 'live-self')).toBe('live-self')
    expect(resolveBzSelfPuuid(undefined, null)).toBeNull()
  })
})
