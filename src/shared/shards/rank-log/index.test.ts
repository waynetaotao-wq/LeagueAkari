import { describe, expect, it } from 'vitest'

import {
  RANK_LOG_CLOCK_TOLERANCE_MS,
  RANK_LOG_QUERY_DEFAULT_LIMIT,
  RANK_LOG_QUERY_MAX_LIMIT,
  type RankSnapshot,
  fromAbsoluteLp,
  isApexTier,
  normalizeRankLogLimit,
  pickRankLogGame,
  readRankLogGame,
  readRankLogTrackedGame,
  readRankSnapshot,
  readRankSnapshots,
  reconcileRankSnapshots,
  toAbsoluteLp
} from './index'

const snapshot = (values: Partial<RankSnapshot> = {}): RankSnapshot => {
  const base = {
    queueType: 'RANKED_SOLO_5x5' as const,
    tier: 'GOLD',
    division: 'II',
    leaguePoints: 40,
    wins: 10,
    losses: 8,
    provisional: false,
    ...values
  }
  return {
    ...base,
    absoluteLp:
      values.absoluteLp !== undefined
        ? values.absoluteLp
        : base.provisional
          ? null
          : toAbsoluteLp(base.tier, base.division, base.leaguePoints)
  }
}

const participant = (values: Record<string, unknown> = {}) => ({
  puuid: 'self',
  championId: 103,
  teamPosition: 'MIDDLE',
  individualPosition: 'MIDDLE',
  win: true,
  kills: 7,
  deaths: 2,
  assists: 9,
  totalMinionsKilled: 180,
  neutralMinionsKilled: 12,
  gameEndedInEarlySurrender: false,
  ...values
})

const summary = (json: Record<string, unknown> = {}, own: Record<string, unknown> = {}) => ({
  json: {
    gameId: 5_000_001,
    queueId: 420,
    mapId: 11,
    gameCreation: 1_700_000_000_000,
    gameDuration: 1800,
    gameEndTimestamp: 1_700_000_000_000 + 1_900_000,
    endOfGameResult: 'GameComplete',
    participants: [participant(own), participant({ puuid: 'other', win: false })],
    ...json
  }
})

describe('toAbsoluteLp', () => {
  it.each([
    ['IRON', 'IV', 0, 0],
    ['BRONZE', 'IV', 5, 405],
    ['SILVER', 'I', 77, 1177],
    ['EMERALD', 'IV', 0, 2000],
    ['DIAMOND', 'I', 99, 2799],
    ['MASTER', 'I', 0, 2800],
    ['GRANDMASTER', 'I', 412, 3212],
    ['CHALLENGER', '', 1105, 3905],
    ['gold', 'ii', 40, 1440]
  ])('%s %s %i LP is %i', (tier, division, leaguePoints, expected) => {
    expect(toAbsoluteLp(tier, division, leaguePoints)).toBe(expected)
  })

  it.each([
    ['', 'NA', 0],
    ['NONE', 'NA', 0],
    ['GOLD', 'V', 10],
    ['GOLD', 'II', -5],
    ['GOLD', 'II', Number.NaN],
    [undefined, 'II', 10]
  ])('returns null for an unranked or broken value: %s %s %s', (tier, division, leaguePoints) => {
    expect(toAbsoluteLp(tier, division, leaguePoints)).toBeNull()
  })

  it('keeps a promotion or demotion a plain difference', () => {
    const before = toAbsoluteLp('GOLD', 'I', 90)!
    expect(toAbsoluteLp('PLATINUM', 'IV', 12)! - before).toBe(22)
    expect(toAbsoluteLp('GOLD', 'II', 75)! - toAbsoluteLp('GOLD', 'I', 0)!).toBe(-25)
    expect(toAbsoluteLp('MASTER', 'I', 5)! - toAbsoluteLp('DIAMOND', 'I', 80)!).toBe(25)
  })
})

describe('fromAbsoluteLp', () => {
  it.each([
    [0, 'IRON', 'IV', 0],
    [405, 'BRONZE', 'IV', 5],
    [1177, 'SILVER', 'I', 77],
    [2799, 'DIAMOND', 'I', 99],
    [2800, 'MASTER', '', 0],
    [3905, 'MASTER', '', 1105],
    [-40, 'IRON', 'IV', 0],
    [1440.4, 'GOLD', 'II', 40]
  ])('%d reads as %s %s %i LP', (value, tier, division, leaguePoints) => {
    expect(fromAbsoluteLp(value)).toEqual({ tier, division, leaguePoints })
  })

  it('is the inverse of toAbsoluteLp below the apex tiers', () => {
    for (let value = 0; value < 2800; value += 37) {
      const rank = fromAbsoluteLp(value)
      expect(toAbsoluteLp(rank.tier, rank.division, rank.leaguePoints)).toBe(value)
    }
  })

  it('knows the apex tiers', () => {
    expect(isApexTier('MASTER')).toBe(true)
    expect(isApexTier('challenger')).toBe(true)
    expect(isApexTier('DIAMOND')).toBe(false)
    expect(isApexTier(null)).toBe(false)
  })
})

describe('readRankSnapshot', () => {
  it('reads a ranked queue entry', () => {
    expect(
      readRankSnapshot({
        queueType: 'RANKED_SOLO_5x5',
        tier: 'emerald',
        division: 'ii',
        leaguePoints: 15,
        wins: 64,
        losses: 58,
        isProvisional: false,
        provisionalGamesRemaining: 0
      })
    ).toEqual({
      queueType: 'RANKED_SOLO_5x5',
      tier: 'EMERALD',
      division: 'II',
      leaguePoints: 15,
      wins: 64,
      losses: 58,
      provisional: false,
      absoluteLp: 2215
    })
  })

  it('keeps an unranked queue with no comparable points', () => {
    expect(
      readRankSnapshot({
        queueType: 'RANKED_FLEX_SR',
        tier: '',
        division: 'NA',
        leaguePoints: 0,
        wins: 0,
        losses: 0,
        isProvisional: false
      })
    ).toMatchObject({ queueType: 'RANKED_FLEX_SR', tier: '', absoluteLp: null })
  })

  it.each([{ isProvisional: true }, { isProvisional: false, provisionalGamesRemaining: 3 }])(
    'hides the points while placements are running: %o',
    (flags) => {
      expect(
        readRankSnapshot({
          queueType: 'RANKED_SOLO_5x5',
          tier: 'SILVER',
          division: 'I',
          leaguePoints: 20,
          wins: 1,
          losses: 1,
          ...flags
        })
      ).toMatchObject({ provisional: true, absoluteLp: null, tier: 'SILVER' })
    }
  )

  it.each([
    null,
    'text',
    { queueType: 'RANKED_TFT', tier: 'GOLD', division: 'I', leaguePoints: 1, wins: 1, losses: 1 },
    { queueType: 'RANKED_SOLO_5x5', tier: 'GOLD', division: 'I', leaguePoints: 1, wins: 1 },
    {
      queueType: 'RANKED_SOLO_5x5',
      tier: 'GOLD',
      division: 'I',
      leaguePoints: -1,
      wins: 1,
      losses: 1
    },
    {
      queueType: 'RANKED_SOLO_5x5',
      tier: 'GOLD',
      division: 'I',
      leaguePoints: 1.5,
      wins: 1,
      losses: 1
    }
  ])('rejects other queues and broken entries: %o', (entry) => {
    expect(readRankSnapshot(entry)).toBeNull()
  })

  it('reads both Rift queues in a fixed order and ignores the rest', () => {
    const snapshots = readRankSnapshots({
      queues: [
        {
          queueType: 'RANKED_TFT',
          tier: 'GOLD',
          division: 'I',
          leaguePoints: 1,
          wins: 1,
          losses: 1
        },
        {
          queueType: 'RANKED_FLEX_SR',
          tier: 'SILVER',
          division: 'IV',
          leaguePoints: 3,
          wins: 2,
          losses: 5
        },
        {
          queueType: 'RANKED_SOLO_5x5',
          tier: 'GOLD',
          division: 'II',
          leaguePoints: 40,
          wins: 10,
          losses: 8
        }
      ]
    })
    expect(snapshots.map((entry) => entry.queueType)).toEqual(['RANKED_SOLO_5x5', 'RANKED_FLEX_SR'])
    expect(readRankSnapshots(null)).toEqual([])
    expect(readRankSnapshots({ queues: 'broken' })).toEqual([])
  })
})

describe('reconcileRankSnapshots', () => {
  it('starts with a baseline', () => {
    expect(reconcileRankSnapshots(null, snapshot())).toEqual({ kind: 'baseline' })
  })

  it('reports nothing when the rank did not move', () => {
    expect(reconcileRankSnapshots(snapshot(), snapshot())).toBeNull()
  })

  it('reads a win and its points from the counters', () => {
    expect(reconcileRankSnapshots(snapshot(), snapshot({ wins: 11, leaguePoints: 62 }))).toEqual({
      kind: 'game',
      win: true,
      lpDelta: 22
    })
  })

  it('reads a loss across a demotion', () => {
    expect(
      reconcileRankSnapshots(
        snapshot({ division: 'II', leaguePoints: 5 }),
        snapshot({ division: 'III', leaguePoints: 82, losses: 9 })
      )
    ).toEqual({ kind: 'game', win: false, lpDelta: -23 })
  })

  it('keeps the result but no points while placements are running', () => {
    expect(
      reconcileRankSnapshots(
        snapshot({ provisional: true, wins: 2, losses: 1 }),
        snapshot({ provisional: true, wins: 3, losses: 1 })
      )
    ).toEqual({ kind: 'game', win: true, lpDelta: null })
    expect(
      reconcileRankSnapshots(
        snapshot({ provisional: true, wins: 4, losses: 0 }),
        snapshot({ provisional: false, wins: 5, losses: 0 })
      )
    ).toEqual({ kind: 'game', win: true, lpDelta: null })
  })

  it('folds several unseen games into one gap', () => {
    expect(
      reconcileRankSnapshots(snapshot(), snapshot({ wins: 12, losses: 9, leaguePoints: 58 }))
    ).toEqual({ kind: 'gap', games: 3, lpDelta: 18 })
  })

  it('reports a change without a game as an adjustment', () => {
    expect(reconcileRankSnapshots(snapshot(), snapshot({ leaguePoints: 35 }))).toEqual({
      kind: 'adjustment',
      lpDelta: -5
    })
    expect(reconcileRankSnapshots(snapshot({ provisional: true }), snapshot())).toEqual({
      kind: 'adjustment',
      lpDelta: null
    })
  })

  it.each([
    [{ wins: 0, losses: 0, tier: '', division: 'NA', leaguePoints: 0 }],
    [{ wins: 11, losses: 3 }],
    [{ wins: 4, losses: 9 }]
  ])('starts over when a counter went down: %o', (values) => {
    expect(reconcileRankSnapshots(snapshot(), snapshot(values))).toEqual({ kind: 'baseline' })
  })
})

describe('readRankLogGame', () => {
  it('reads the own line of a ranked game', () => {
    expect(readRankLogGame(summary(), 'self')).toEqual({
      gameId: 5_000_001,
      queueType: 'RANKED_SOLO_5x5',
      gameCreation: 1_700_000_000_000,
      gameEnd: 1_700_000_000_000 + 1_900_000,
      gameDuration: 1800,
      championId: 103,
      position: 'MIDDLE',
      win: true,
      remake: false,
      kills: 7,
      deaths: 2,
      assists: 9,
      cs: 192
    })
  })

  it('reads the flex queue and falls back to the individual position', () => {
    expect(
      readRankLogGame(
        summary({ queueId: 440 }, { teamPosition: '', individualPosition: 'TOP' }),
        'self'
      )
    ).toMatchObject({ queueType: 'RANKED_FLEX_SR', position: 'TOP' })
  })

  it('derives the end from the duration when the server gives none', () => {
    expect(readRankLogGame(summary({ gameEndTimestamp: undefined }), 'self')?.gameEnd).toBe(
      1_700_000_000_000 + 1_800_000
    )
    expect(readRankLogGame(summary({ gameEndTimestamp: 5 }), 'self')?.gameEnd).toBe(
      1_700_000_000_000 + 1_800_000
    )
  })

  it.each([
    [{ endOfGameResult: 'Abort_TooFewPlayers' }, {}],
    [{ endOfGameResult: 'Remake' }, {}],
    [{}, { gameEndedInEarlySurrender: true }]
  ])('marks a remade game: %o %o', (json, own) => {
    expect(readRankLogGame(summary(json, own), 'self')?.remake).toBe(true)
  })

  it('leaves unknown numbers empty instead of guessing', () => {
    expect(
      readRankLogGame(summary({}, { kills: undefined, neutralMinionsKilled: 'x' }), 'self')
    ).toMatchObject({ kills: null, cs: null, deaths: 2 })
  })

  it.each([
    ['another queue', summary({ queueId: 430 })],
    ['another map', summary({ mapId: 12 })],
    ['a broken id', summary({ gameId: 0 })],
    ['no creation time', summary({ gameCreation: 0 })],
    ['no duration', summary({ gameDuration: undefined })],
    ['no participants', summary({ participants: 'broken' })],
    ['no result', summary({}, { win: undefined })],
    ['nothing', null],
    ['no body', {}]
  ])('rejects %s', (_, value) => {
    expect(readRankLogGame(value, 'self')).toBeNull()
  })

  it('rejects a game the player was not part of', () => {
    expect(readRankLogGame(summary(), 'stranger')).toBeNull()
  })
})

describe('readRankLogTrackedGame', () => {
  const session = (gameData: Record<string, unknown> = {}) => ({
    gameData: {
      gameId: 5_000_009,
      isCustomGame: false,
      queue: { id: 420 },
      teamOne: [{ puuid: 'self' }],
      teamTwo: [{ puuid: 'enemy' }],
      ...gameData
    }
  })

  it('reads a ranked game the player is in', () => {
    expect(readRankLogTrackedGame(session(), 'self')).toEqual({
      gameId: 5_000_009,
      queueType: 'RANKED_SOLO_5x5'
    })
    expect(readRankLogTrackedGame(session({ queue: { id: 440 } }), 'enemy')).toEqual({
      gameId: 5_000_009,
      queueType: 'RANKED_FLEX_SR'
    })
  })

  it('accepts a session whose rosters are not filled in yet', () => {
    expect(readRankLogTrackedGame(session({ teamOne: [], teamTwo: [] }), 'self')).not.toBeNull()
    expect(
      readRankLogTrackedGame(session({ teamOne: undefined, teamTwo: undefined }), 'self')
    ).not.toBeNull()
  })

  it.each([
    ['another queue', session({ queue: { id: 450 } })],
    ['a custom game', session({ isCustomGame: true })],
    ['no game id', session({ gameId: 0 })],
    ['no queue', session({ queue: null })],
    ['nothing', null],
    ['no game data', {}]
  ])('ignores %s', (_, value) => {
    expect(readRankLogTrackedGame(value, 'self')).toBeNull()
  })

  it('ignores a game somebody else is playing', () => {
    expect(readRankLogTrackedGame(session(), 'stranger')).toBeNull()
  })
})

describe('pickRankLogGame', () => {
  const game = (gameId: number, gameEnd: number, win = true, remake = false) => ({
    gameId,
    gameEnd,
    win,
    remake
  })

  it('picks the only game that ended between the two readings', () => {
    expect(
      pickRankLogGame([game(1, 500), game(2, 1500), game(3, 9_000_000)], {
        after: 1000,
        before: 2000,
        win: true
      })
    ).toEqual(game(2, 1500))
  })

  it('needs the result to agree', () => {
    expect(
      pickRankLogGame([game(2, 1500, false)], { after: 1000, before: 2000, win: true })
    ).toBeNull()
  })

  it('never picks a remade game', () => {
    expect(
      pickRankLogGame([game(2, 1500, true, true)], { after: 1000, before: 2000, win: true })
    ).toBeNull()
  })

  it('refuses to choose between two fitting games', () => {
    expect(
      pickRankLogGame([game(2, 1500), game(3, 1800)], { after: 1000, before: 2000, win: true })
    ).toBeNull()
    expect(
      pickRankLogGame([game(2, 1500), game(3, 1800, false)], {
        after: 1000,
        before: 2000,
        win: true
      })
    ).toEqual(game(2, 1500))
  })

  it('allows the local clock to run a little behind the server', () => {
    const change = { after: 1000, before: 2000, win: true }
    expect(pickRankLogGame([game(2, 2000 + RANK_LOG_CLOCK_TOLERANCE_MS)], change)).not.toBeNull()
    expect(pickRankLogGame([game(2, 2001 + RANK_LOG_CLOCK_TOLERANCE_MS)], change)).toBeNull()
    expect(pickRankLogGame([game(2, 1000)], change)).toBeNull()
  })
})

describe('normalizeRankLogLimit', () => {
  it('falls back to the default and caps the size', () => {
    expect(normalizeRankLogLimit(undefined)).toBe(RANK_LOG_QUERY_DEFAULT_LIMIT)
    expect(normalizeRankLogLimit(0)).toBe(RANK_LOG_QUERY_DEFAULT_LIMIT)
    expect(normalizeRankLogLimit(2.5)).toBe(RANK_LOG_QUERY_DEFAULT_LIMIT)
    expect(normalizeRankLogLimit(30)).toBe(30)
    expect(normalizeRankLogLimit(999_999)).toBe(RANK_LOG_QUERY_MAX_LIMIT)
  })
})
