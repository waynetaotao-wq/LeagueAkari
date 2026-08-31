import { describe, expect, it } from 'vitest'

import {
  type MatchupLifecycleState,
  type MatchupSessionIdentity,
  areSameMatchupSession,
  createMatchupRequestToken,
  isCurrentMatchupGameData,
  isCurrentMatchupRequest,
  matchupSessionIdentityKey,
  observeMatchupSession,
  resolveAssignedLaneOpponent,
  resolveMatchupCorrectionDisposition,
  resolveMatchupSessionIdentity,
  resolveRealMatchupValidation,
  resolveScopedMatchupTarget
} from './matchup-lifecycle'

const emptyState = (): MatchupLifecycleState => ({ current: null, lastKnown: null, generation: 0 })
const sessionA: MatchupSessionIdentity = { sessionId: 'champ-a', gameId: 101 }
const sessionB: MatchupSessionIdentity = { sessionId: 'champ-b', gameId: 202 }

describe('matchup session lifecycle', () => {
  it('uses champ-select identity only in ChampSelect and rejects stale gameflow data', () => {
    expect(
      resolveMatchupSessionIdentity({
        phase: 'ChampSelect',
        champSelectSession: { id: 'champ-b', gameId: 202 },
        gameflowSession: { gameData: { gameId: 101 } }
      })
    ).toEqual(sessionB)
    expect(
      resolveMatchupSessionIdentity({
        phase: 'Lobby',
        champSelectSession: null,
        gameflowSession: { gameData: { gameId: 101 } }
      })
    ).toBeNull()
  })

  it('uses the same positive gameId across ChampSelect and GameStart', () => {
    const inGame = resolveMatchupSessionIdentity({
      phase: 'GameStart',
      champSelectSession: null,
      gameflowSession: { gameData: { gameId: 101 } }
    })
    expect(areSameMatchupSession(sessionA, inGame)).toBe(true)
  })

  it('prefers the current champ-select game during a GameStart event-order gap', () => {
    expect(
      resolveMatchupSessionIdentity({
        phase: 'GameStart',
        champSelectSession: { id: 'champ-b', gameId: 202 },
        gameflowSession: { gameData: { gameId: 101 } }
      })
    ).toEqual(sessionB)
    expect(isCurrentMatchupGameData(sessionB, 101)).toBe(false)
    expect(isCurrentMatchupGameData(sessionB, 202)).toBe(true)
  })

  it('treats zero and invalid game ids as unavailable', () => {
    expect(
      resolveMatchupSessionIdentity({
        phase: 'GameStart',
        champSelectSession: null,
        gameflowSession: { gameData: { gameId: 0 } }
      })
    ).toBeNull()
  })

  it('does not reset for repeated payloads or the same-game phase handoff', () => {
    const first = observeMatchupSession(emptyState(), sessionA)
    const repeated = observeMatchupSession(first.state, { ...sessionA })
    const handoff = observeMatchupSession(repeated.state, { sessionId: null, gameId: 101 })
    expect(first.startedNewSession).toBe(true)
    expect(repeated.startedNewSession).toBe(false)
    expect(handoff.startedNewSession).toBe(false)
    expect(handoff.state.lastKnown).toEqual(sessionA)
  })

  it('produces a stable watcher key for repeated payload objects', () => {
    expect(matchupSessionIdentityKey(sessionA)).toBe(matchupSessionIdentityKey({ ...sessionA }))
    expect(matchupSessionIdentityKey(sessionA)).not.toBe(matchupSessionIdentityKey(sessionB))
  })

  it('changes the watcher key for a new champ-select session even if the game id is reused', () => {
    expect(matchupSessionIdentityKey(sessionA)).not.toBe(
      matchupSessionIdentityKey({ sessionId: 'champ-b', gameId: sessionA.gameId })
    )
  })

  it('keeps lastKnown through a null gap and detects a new game without end phases', () => {
    const first = observeMatchupSession(emptyState(), sessionA)
    const gap = observeMatchupSession(first.state, null)
    const next = observeMatchupSession(gap.state, sessionB)
    expect(gap.state.lastKnown).toEqual(sessionA)
    expect(next.startedNewSession).toBe(true)
    expect(next.state.generation).toBe(2)
  })

  it('cuts an old in-game manual target when a new ChampSelect arrives over stale gameData', () => {
    const first = observeMatchupSession(emptyState(), sessionA)
    const nextIdentity = resolveMatchupSessionIdentity({
      phase: 'ChampSelect',
      champSelectSession: { id: 'champ-b', gameId: 202 },
      gameflowSession: { gameData: { gameId: 101 } }
    })
    const next = observeMatchupSession(first.state, nextIdentity)
    const target = resolveScopedMatchupTarget({
      currentSession: next.state.current,
      manualTarget: { championId: 799, owner: sessionA },
      enemyChampionIds: [799, 82],
      automaticResolution: { championId: 82, probability: 0.91 }
    })

    expect(next.startedNewSession).toBe(true)
    expect(target).toEqual({ championId: 82, probability: 0.91, source: 'automatic' })
  })

  it('treats a changed champ-select id as a new session even if gameId is reused', () => {
    expect(areSameMatchupSession(sessionA, { sessionId: 'champ-b', gameId: 101 })).toBe(false)
  })
})

describe('match-scoped target and request guards', () => {
  it('honors a manual target only in its owning session', () => {
    const manual = { championId: 799, owner: sessionA }
    expect(
      resolveScopedMatchupTarget({
        currentSession: sessionA,
        manualTarget: manual,
        enemyChampionIds: [799, 82],
        automaticResolution: { championId: 82, probability: 0.88 }
      })
    ).toEqual({ championId: 799, probability: null, source: 'manual' })

    expect(
      resolveScopedMatchupTarget({
        currentSession: sessionB,
        manualTarget: manual,
        enemyChampionIds: [799, 82],
        automaticResolution: { championId: 82, probability: 0.88 }
      })
    ).toEqual({ championId: 82, probability: 0.88, source: 'automatic' })
  })

  it('labels the same repeated enemy as automatic in the next session', () => {
    expect(
      resolveScopedMatchupTarget({
        currentSession: sessionB,
        manualTarget: { championId: 799, owner: sessionA },
        enemyChampionIds: [799],
        automaticResolution: { championId: 799, probability: 0.93 }
      })
    ).toEqual({ championId: 799, probability: 0.93, source: 'automatic' })
  })

  it('rejects an old request after the game changes even when all build fields are identical', () => {
    const first = observeMatchupSession(emptyState(), sessionA)
    const token = createMatchupRequestToken(first.state)
    const next = observeMatchupSession(first.state, sessionB)
    expect(token).not.toBeNull()
    expect(isCurrentMatchupRequest(token!, first.state)).toBe(true)
    expect(isCurrentMatchupRequest(token!, next.state)).toBe(false)
  })

  it('rejects an old request when a reused gameId belongs to a new champ-select session', () => {
    const first = observeMatchupSession(emptyState(), sessionA)
    const token = createMatchupRequestToken(first.state)!
    const next = observeMatchupSession(first.state, { sessionId: 'champ-b', gameId: 101 })
    expect(next.startedNewSession).toBe(true)
    expect(isCurrentMatchupRequest(token, next.state)).toBe(false)
  })

  it('does not revive an expired manual target while automatic inference is still loading', () => {
    expect(
      resolveScopedMatchupTarget({
        currentSession: sessionB,
        manualTarget: { championId: 799, owner: sessionA },
        enemyChampionIds: [799, 82],
        automaticResolution: null
      })
    ).toBeNull()
  })
})

describe('direct assigned-position inference', () => {
  it('prefers the unique enemy assigned to my lane', () => {
    expect(
      resolveAssignedLaneOpponent(
        [
          { championId: 82, assignedPosition: 'TOP' },
          { championId: 99, assignedPosition: 'MIDDLE' }
        ],
        'top'
      )
    ).toBe(82)
  })

  it('fails closed when two enemies claim the same lane', () => {
    expect(
      resolveAssignedLaneOpponent(
        [
          { championId: 82, assignedPosition: 'top' },
          { championPickIntent: 799, assignedPosition: 'top' }
        ],
        'top'
      )
    ).toBeNull()
  })

  it('waits for positions, then corrects prediction A to the unique real opponent B', () => {
    expect(
      resolveRealMatchupValidation(
        [
          { championId: 82, selectedPosition: '' },
          { championId: 799, selectedPosition: '' }
        ],
        'top',
        82
      )
    ).toEqual({ status: 'waiting', opponentChampionId: null })
    expect(
      resolveRealMatchupValidation(
        [
          { championId: 82, selectedPosition: 'MIDDLE' },
          { championId: 799, selectedPosition: 'TOP' }
        ],
        'top',
        82
      )
    ).toEqual({ status: 'corrected', opponentChampionId: 799 })
  })

  it('confirms only the unique real opponent in the expected lane', () => {
    expect(resolveRealMatchupValidation([{ championId: 82, position: 'TOP' }], 'top', 82)).toEqual({
      status: 'confirmed',
      opponentChampionId: 82
    })
  })

  it('drops the stale predicted lock when a current real-opponent build is unavailable', () => {
    expect(
      resolveMatchupCorrectionDisposition({
        requestSequence: 7,
        currentSequence: 7,
        applied: false
      })
    ).toBe('drop-stale-lock')
    expect(
      resolveMatchupCorrectionDisposition({
        requestSequence: 7,
        currentSequence: 8,
        applied: false
      })
    ).toBe('superseded')
    expect(
      resolveMatchupCorrectionDisposition({
        requestSequence: 7,
        currentSequence: 7,
        applied: true
      })
    ).toBe('applied')
  })
})
