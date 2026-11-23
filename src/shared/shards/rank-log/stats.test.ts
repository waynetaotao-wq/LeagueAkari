import { describe, expect, it } from 'vitest'

import type { RankLogEntryDto } from './index'
import {
  RANK_LOG_MIN_RATE_GAMES,
  RANK_LOG_SESSION_GAP_MS,
  rankLogDay,
  rankLogWinRate,
  summarizeRankLog
} from './stats'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
/** 2026-11-10 12:00 UTC. */
const NOON = Date.UTC(2026, 10, 10, 12)
let nextId = 1

const entry = (values: Partial<RankLogEntryDto> = {}): RankLogEntryDto => ({
  id: nextId++,
  kind: 'game',
  queueType: 'RANKED_SOLO_5x5',
  occurredAt: NOON,
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

/** A counted game that ended `endOffset` after noon and lasted thirty minutes. */
const played = (endOffset: number, win: boolean, values: Partial<RankLogEntryDto> = {}) =>
  entry({
    occurredAt: NOON + endOffset,
    gameCreation: NOON + endOffset - 30 * MINUTE,
    gameDuration: 1700,
    gameId: 1000 + nextId,
    win,
    remake: false,
    ...values
  })

const reading = (absoluteLp: number, at: number, values: Partial<RankLogEntryDto> = {}) => ({
  observedAt: NOON + at,
  absoluteLp,
  tier: 'GOLD',
  division: 'II',
  leaguePoints: absoluteLp - 1400,
  provisional: false,
  ...values
})

const summarize = (entries: RankLogEntryDto[], now = NOON + 10 * HOUR) =>
  summarizeRankLog(entries, { queueType: 'RANKED_SOLO_5x5', now, timezoneOffsetMinutes: 0 })

describe('summarizeRankLog', () => {
  it('returns an empty summary for an empty log', () => {
    expect(summarize([])).toMatchObject({
      current: null,
      points: [],
      net: null,
      netSince: null,
      games: [],
      total: { games: 0, wins: 0, losses: 0, lpDelta: 0, lpGames: 0 },
      streak: null,
      sessions: [],
      activeSession: null,
      days: [],
      averageWinLp: null,
      averageLossLp: null,
      unrecordedGames: 0,
      gaps: 0,
      adjustments: { count: 0, lpDelta: 0 }
    })
  })

  it('only reads the requested queue', () => {
    const summary = summarize([
      played(0, true),
      played(HOUR, false, { queueType: 'RANKED_FLEX_SR' }),
      entry({ kind: 'baseline', queueType: 'RANKED_FLEX_SR', ...reading(900, 0) })
    ])
    expect(summary.total).toMatchObject({ games: 1, wins: 1 })
    expect(summary.current).toBeNull()
  })

  it('counts results and points, leaving remakes and unknown results out', () => {
    const summary = summarize([
      played(0, true, { lpDelta: 22, ...reading(1462, 1) }),
      played(HOUR, false, { lpDelta: -18, ...reading(1444, HOUR + 1) }),
      played(2 * HOUR, true),
      played(3 * HOUR, false, { remake: true }),
      entry({ occurredAt: NOON + 4 * HOUR, gameId: 77 })
    ])

    expect(summary.total).toEqual({ games: 3, wins: 2, losses: 1, lpDelta: 4, lpGames: 2 })
    expect(summary.unrecordedGames).toBe(1)
    expect(summary.averageWinLp).toBe(22)
    expect(summary.averageLossLp).toBe(-18)
    expect(summary.games.map((game) => game.win)).toEqual([true, false, true])
  })

  it('reads the current rank and the curve from the readings in the order they were taken', () => {
    const baseline = entry({ kind: 'baseline', occurredAt: NOON, ...reading(1440, 0) })
    // 这一局结束得早，但段位是后来才读到的。
    const late = played(-2 * HOUR, true, { lpDelta: 20, ...reading(1460, 30 * MINUTE) })
    const adjustment = entry({
      kind: 'adjustment',
      occurredAt: NOON + HOUR,
      lpDelta: -5,
      ...reading(1455, HOUR)
    })
    const summary = summarize([adjustment, late, baseline, played(-5 * HOUR, false)])

    expect(summary.points.map((point) => point.absoluteLp)).toEqual([1440, 1460, 1455])
    expect(summary.current).toBe(adjustment)
    expect(summary.net).toBe(15)
    expect(summary.netSince).toBe(NOON)
    expect(summary.adjustments).toEqual({ count: 1, lpDelta: -5 })
  })

  it('leaves readings without comparable points out of the curve', () => {
    const summary = summarize([
      entry({ kind: 'baseline', ...reading(1440, 0), absoluteLp: null, provisional: true }),
      played(HOUR, true, { ...reading(1500, HOUR), absoluteLp: null, provisional: true }),
      played(2 * HOUR, true, { lpDelta: null, ...reading(1510, 2 * HOUR) })
    ])
    expect(summary.points).toHaveLength(1)
    expect(summary.net).toBeNull()
    expect(summary.current?.absoluteLp).toBe(1510)
  })

  it('measures the net change from the latest starting point only', () => {
    const summary = summarize([
      entry({ kind: 'baseline', ...reading(2100, -100 * HOUR) }),
      played(-99 * HOUR, true, { lpDelta: 20, ...reading(2120, -99 * HOUR) }),
      // 新赛季：计数清零后重新起步。
      entry({ kind: 'baseline', ...reading(1400, 0) }),
      played(HOUR, false, { lpDelta: -15, ...reading(1385, HOUR) })
    ])
    expect(summary.points).toHaveLength(4)
    expect(summary.net).toBe(-15)
    expect(summary.netSince).toBe(NOON)
  })

  it('reports the running streak', () => {
    expect(
      summarize([played(0, true), played(HOUR, false), played(2 * HOUR, false)]).streak
    ).toEqual({ win: false, length: 2 })
    expect(
      summarize([
        played(0, false),
        played(HOUR, true),
        played(2 * HOUR, true),
        played(3 * HOUR, true)
      ]).streak
    ).toEqual({ win: true, length: 3 })
    // 中间的重开不打断连胜。
    expect(
      summarize([played(0, true), played(HOUR, false, { remake: true }), played(2 * HOUR, true)])
        .streak
    ).toEqual({ win: true, length: 2 })
  })

  it('limits the recent tally to the last twenty counted games', () => {
    const games = Array.from({ length: 25 }, (_, index) => played(index * HOUR, index >= 5))
    expect(summarize(games).recent).toMatchObject({ games: 20, wins: 20, losses: 0 })
    expect(summarize(games).total).toMatchObject({ games: 25, wins: 20, losses: 5 })
  })

  it('splits games into sessions by the pause between them', () => {
    const summary = summarize([
      played(0, true),
      // 上一局结束 20 分钟后开下一局：同一段。
      played(50 * MINUTE, false),
      played(100 * MINUTE, false),
      // 上一局结束 61 分钟后才开：新的一段。
      played(100 * MINUTE + RANK_LOG_SESSION_GAP_MS + 31 * MINUTE, true)
    ])

    expect(summary.sessions.map((session) => session.tally.games)).toEqual([3, 1])
    expect(summary.sessions[0]).toMatchObject({
      startedAt: NOON - 30 * MINUTE,
      endedAt: NOON + 100 * MINUTE,
      lossStreak: 2
    })
    expect(summary.sessions[1].lossStreak).toBe(0)
    expect(summary.games.map((game) => [game.sessionIndex, game.lossesBefore])).toEqual([
      [1, 0],
      [2, 0],
      [3, 1],
      [1, 0]
    ])
  })

  it('keeps a pause of exactly the limit in the same session', () => {
    const summary = summarize([
      played(0, true),
      played(RANK_LOG_SESSION_GAP_MS + 30 * MINUTE, true)
    ])
    expect(summary.sessions).toHaveLength(1)
  })

  it('uses the moment a change was seen for a game whose match is unknown', () => {
    const summary = summarize([
      played(0, false),
      entry({ occurredAt: NOON + 40 * MINUTE, win: false, lpDelta: -20 })
    ])
    expect(summary.sessions).toHaveLength(1)
    expect(summary.games[1]).toMatchObject({ startedAt: NOON + 40 * MINUTE, lossesBefore: 1 })
  })

  it('reports the last session only while it may still be running', () => {
    const games = [played(0, false), played(50 * MINUTE, false)]
    expect(
      summarize(games, NOON + 50 * MINUTE + RANK_LOG_SESSION_GAP_MS).activeSession
    ).toMatchObject({ lossStreak: 2, tally: { games: 2, losses: 2 } })
    expect(summarize(games, NOON + 51 * MINUTE + RANK_LOG_SESSION_GAP_MS).activeSession).toBeNull()
  })

  it('tallies games by their place in the session, with the fifth bucket taking the rest', () => {
    const first = Array.from({ length: 7 }, (_, index) => played(index * 40 * MINUTE, index < 2))
    const second = [played(30 * HOUR, true), played(30 * HOUR + 40 * MINUTE, false)]
    const summary = summarize([...first, ...second])

    expect(summary.bySessionIndex.map((tally) => [tally.games, tally.wins])).toEqual([
      [2, 2],
      [2, 1],
      [1, 0],
      [1, 0],
      [3, 0]
    ])
  })

  it('separates games started after two straight losses in the same session', () => {
    const summary = summarize([
      played(0, false),
      played(40 * MINUTE, false),
      played(80 * MINUTE, false, { lpDelta: -20 }),
      played(120 * MINUTE, true, { lpDelta: 21 }),
      played(160 * MINUTE, true),
      // 隔天再开：之前的连败不带过来。
      played(30 * HOUR, false),
      played(30 * HOUR + 40 * MINUTE, false),
      played(60 * HOUR, true)
    ])

    expect(summary.afterLossStreak).toEqual({
      games: 2,
      wins: 1,
      losses: 1,
      lpDelta: 1,
      lpGames: 2
    })
    expect(summary.otherGames).toMatchObject({ games: 6, wins: 2, losses: 4 })
  })

  it('groups by the day that starts at five in the morning, newest first', () => {
    const summary = summarize([
      // 11 月 10 日 12:00 与次日 03:00 属于同一天，次日 06:00 属于下一天。
      played(0, true, { lpDelta: 20 }),
      played(15 * HOUR, false, { lpDelta: -18 }),
      played(18 * HOUR, true, { lpDelta: 21 }),
      entry({ kind: 'adjustment', occurredAt: NOON + 19 * HOUR, lpDelta: -5 }),
      played(40 * HOUR, true)
    ])

    expect(summary.days).toEqual([
      {
        day: '2026-11-11',
        tally: { games: 2, wins: 2, losses: 0, lpDelta: 21, lpGames: 1 },
        net: 16
      },
      { day: '2026-11-10', tally: { games: 2, wins: 1, losses: 1, lpDelta: 2, lpGames: 2 }, net: 2 }
    ])
  })

  it('counts gaps and keeps their change in the daily net', () => {
    const summary = summarize([
      entry({ kind: 'gap', occurredAt: NOON, games: 3, lpDelta: 12, ...reading(1452, 0) })
    ])
    expect(summary.gaps).toBe(1)
    expect(summary.total.games).toBe(0)
    expect(summary.days).toEqual([
      {
        day: '2026-11-10',
        tally: { games: 0, wins: 0, losses: 0, lpDelta: 0, lpGames: 0 },
        net: 12
      }
    ])
  })
})

describe('rankLogDay', () => {
  it('moves the small hours to the previous day', () => {
    expect(rankLogDay(Date.UTC(2026, 10, 11, 4, 59), 0)).toBe('2026-11-10')
    expect(rankLogDay(Date.UTC(2026, 10, 11, 5, 0), 0)).toBe('2026-11-11')
  })

  it('applies the given time zone', () => {
    // UTC 11 日 02:00 在东八区是 11 日 10:00，在西五区是 10 日 21:00。
    const moment = Date.UTC(2026, 10, 11, 2)
    expect(rankLogDay(moment, 480)).toBe('2026-11-11')
    expect(rankLogDay(moment, -300)).toBe('2026-11-10')
  })

  it('falls back to the machine time zone', () => {
    const local = new Date(2026, 0, 31, 12)
    expect(rankLogDay(local.getTime())).toBe('2026-01-31')
    expect(rankLogDay(new Date(2026, 1, 1, 3).getTime())).toBe('2026-01-31')
  })
})

describe('rankLogWinRate', () => {
  const tally = (games: number, wins: number) => ({
    games,
    wins,
    losses: games - wins,
    lpDelta: 0,
    lpGames: 0
  })

  it('withholds the rate below the minimum sample', () => {
    expect(rankLogWinRate(tally(RANK_LOG_MIN_RATE_GAMES - 1, 3))).toBeNull()
    expect(rankLogWinRate(tally(RANK_LOG_MIN_RATE_GAMES, 3))).toBe(60)
    expect(rankLogWinRate(tally(0, 0), 0)).toBeNull()
    expect(rankLogWinRate(tally(2, 1), 1)).toBe(50)
  })
})
