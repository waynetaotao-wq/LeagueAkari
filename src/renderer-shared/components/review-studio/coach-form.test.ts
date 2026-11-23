import type { RankLogEntryDto } from '@shared/shards/rank-log'
import { describe, expect, it } from 'vitest'

import { buildReviewCoachForm } from './coach-form'

const HOUR = 3_600_000
const START = Date.UTC(2026, 10, 10, 12)
let nextId = 1

const entry = (values: Partial<RankLogEntryDto> = {}): RankLogEntryDto => ({
  id: nextId++,
  kind: 'game',
  queueType: 'RANKED_SOLO_5x5',
  occurredAt: START,
  observedAt: null,
  gameId: null,
  gameCreation: null,
  gameDuration: null,
  championId: null,
  position: null,
  win: null,
  remake: null,
  kills: null,
  deaths: null,
  assists: null,
  cs: null,
  games: null,
  lpDelta: null,
  tier: null,
  division: null,
  leaguePoints: null,
  absoluteLp: null,
  provisional: null,
  wins: null,
  losses: null,
  ...values
})

/** Four games played back to back: a win, two losses, then the reviewed loss. */
function log(): RankLogEntryDto[] {
  const game = (index: number, win: boolean, lpDelta: number | null, absoluteLp: number) =>
    entry({
      gameId: 100 + index,
      occurredAt: START + index * 40 * 60_000,
      gameCreation: START + index * 40 * 60_000 - 30 * 60_000,
      gameDuration: 1700,
      win,
      remake: false,
      lpDelta,
      observedAt: START + index * 40 * 60_000 + 5000,
      tier: 'GOLD',
      division: 'II',
      leaguePoints: absoluteLp - 1400,
      absoluteLp
    })
  return [
    entry({
      kind: 'baseline',
      observedAt: START - HOUR,
      occurredAt: START - HOUR,
      absoluteLp: 1440
    }),
    game(0, true, 21, 1461),
    game(1, false, -19, 1442),
    game(2, false, -20, 1422),
    game(3, false, -18, 1404)
  ]
}

const options = {
  now: START + 4 * HOUR,
  rankText: (value: RankLogEntryDto) =>
    value.tier ? `${value.tier} ${value.division} ${value.leaguePoints}` : null
}

describe('buildReviewCoachForm', () => {
  it('describes the present form and the reviewed game', () => {
    expect(buildReviewCoachForm(log(), { gameId: 103, queueId: 420 }, options)).toEqual({
      rank: 'GOLD II 4',
      recent: { games: 4, wins: 1 },
      streak: { win: false, length: 3 },
      lpDelta: -18,
      sessionIndex: 4,
      lossesBefore: 2
    })
  })

  it('reads an earlier game of the same session by its own place', () => {
    expect(buildReviewCoachForm(log(), { gameId: 101, queueId: 420 }, options)).toMatchObject({
      lpDelta: -19,
      sessionIndex: 2,
      lossesBefore: 0
    })
  })

  it('keeps the present form but nothing game-specific for a game the log does not hold', () => {
    expect(buildReviewCoachForm(log(), { gameId: 999, queueId: 420 }, options)).toEqual({
      rank: 'GOLD II 4',
      recent: { games: 4, wins: 1 },
      streak: { win: false, length: 3 },
      lpDelta: null,
      sessionIndex: null,
      lossesBefore: null
    })
  })

  it('borrows the solo queue for a normal game without tying the game to it', () => {
    expect(buildReviewCoachForm(log(), { gameId: 103, queueId: 400 }, options)).toMatchObject({
      rank: 'GOLD II 4',
      lpDelta: null,
      sessionIndex: null
    })
  })

  it('reads the flex queue for a flex game', () => {
    const entries = [
      ...log(),
      entry({
        queueType: 'RANKED_FLEX_SR',
        gameId: 500,
        win: true,
        remake: false,
        lpDelta: 25,
        observedAt: START,
        tier: 'SILVER',
        division: 'I',
        leaguePoints: 60,
        absoluteLp: 1160
      })
    ]
    expect(buildReviewCoachForm(entries, { gameId: 500, queueId: 440 }, options)).toEqual({
      rank: 'SILVER I 60',
      recent: { games: 1, wins: 1 },
      streak: { win: true, length: 1 },
      lpDelta: 25,
      sessionIndex: 1,
      lossesBefore: 0
    })
  })

  it('has nothing to say when the queue was never logged', () => {
    expect(buildReviewCoachForm([], { gameId: 1, queueId: 420 }, options)).toBeNull()
    expect(buildReviewCoachForm(log(), { gameId: 1, queueId: 440 }, options)).toBeNull()
  })

  it('leaves the rank empty when no reading exists yet', () => {
    const entries = [entry({ gameId: 7, win: true, remake: false })]
    expect(buildReviewCoachForm(entries, { gameId: 7, queueId: 420 }, options)).toMatchObject({
      rank: null,
      recent: { games: 1, wins: 1 },
      lpDelta: null,
      sessionIndex: 1
    })
  })
})
