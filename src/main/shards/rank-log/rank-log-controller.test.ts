import { type RankLogGameFacts, type RankSnapshot, toAbsoluteLp } from '@shared/shards/rank-log'
import { observable, reaction, runInAction } from 'mobx'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StorageMain } from '../storage'
import { RankLogEntry } from '../storage/entities/RankLogEntry'
import { createTestDataSource, isSqliteAvailable } from '../storage/test-database'
import {
  RANK_LOG_FOLLOW_UP_DELAYS_MS,
  RANK_LOG_HISTORY_FULL_COUNT,
  RANK_LOG_HISTORY_RECENT_COUNT,
  RANK_LOG_TRACKED_GAME_TTL_MS,
  type RankLogMainContext
} from './context'
import { RankLogEntryLoader } from './entry-loader'
import { RankLogController } from './rank-log-controller'
import { RankLogSettings, RankLogState } from './state'

const START = 1_700_000_000_000
const MINUTE = 60_000
const cleanups: Array<() => unknown> = []

const rank = (values: Partial<RankSnapshot> = {}): RankSnapshot => {
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
    absoluteLp: base.provisional ? null : toAbsoluteLp(base.tier, base.division, base.leaguePoints)
  }
}

const game = (gameId: number, gameEnd: number, values: Partial<RankLogGameFacts> = {}) => ({
  gameId,
  queueType: 'RANKED_SOLO_5x5' as const,
  gameCreation: gameEnd - 30 * MINUTE,
  gameEnd,
  gameDuration: 1700,
  championId: 103,
  position: 'MIDDLE',
  win: true,
  remake: false,
  kills: 5,
  deaths: 3,
  assists: 8,
  cs: 190,
  ...values
})

const session = (gameId: number, queueId = 420, puuid = 'self') => ({
  gameData: {
    gameId,
    isCustomGame: false,
    queue: { id: queueId },
    teamOne: [{ puuid }],
    teamTwo: [{ puuid: 'enemy' }]
  }
})

async function createHarness() {
  const dataSource = await createTestDataSource()
  cleanups.push(() => dataSource.destroy())

  const client = observable({
    puuid: 'self' as string | null,
    sgpServerId: 'NA1',
    isTokenReady: true,
    phase: null as string | null,
    session: null as unknown
  })
  const remote = {
    snapshots: [rank()] as RankSnapshot[],
    history: [] as RankLogGameFacts[],
    isHistoryAvailable: true,
    isRankReadable: true,
    isHistoryReadable: true
  }
  const clock = { now: START }
  const listeners = new Map<string, (event: unknown) => void>()
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
  const settings = new RankLogSettings()
  const state = new RankLogState()
  state.setAvailable(true)

  const context = {
    namespace: 'rank-log-main',
    logger,
    ipc: {},
    mobxUtils: {
      reaction: (...args: Parameters<typeof reaction>) => {
        const dispose = reaction(...args)
        cleanups.push(dispose)
        return dispose
      }
    },
    leagueClient: {
      data: {
        summoner: {
          get me() {
            return client.puuid ? { puuid: client.puuid } : null
          }
        },
        gameflow: {
          get phase() {
            return client.phase
          },
          get session() {
            return client.session
          }
        }
      },
      events: {
        on: (uri: string, listener: (event: unknown) => void) => {
          listeners.set(uri, listener)
          return () => listeners.delete(uri)
        }
      }
    },
    sgp: {
      state: {
        get isTokenReady() {
          return client.isTokenReady
        },
        get availability() {
          return { sgpServerId: client.puuid ? client.sgpServerId : '' }
        }
      }
    },
    storage: { dataSource } as unknown as StorageMain,
    settings,
    state
  } as unknown as RankLogMainContext

  const loadSnapshots = vi.fn(async () => {
    if (!remote.isRankReadable) throw new Error('client is not connected')
    return remote.snapshots
  })
  const loadHistory = vi.fn(async (_owner: unknown, count: number) => {
    if (!remote.isHistoryReadable) throw new Error('history request failed')
    return remote.history.slice(0, count)
  })
  const entryLoader = new RankLogEntryLoader(context.storage)
  const createController = () => {
    const controller = new RankLogController(
      context,
      entryLoader,
      { loadSnapshots, loadHistory, canLoadHistory: () => remote.isHistoryAvailable },
      () => clock.now
    )
    cleanups.push(() => controller.dispose())
    return controller
  }

  const rows = (puuid = 'self') =>
    dataSource.manager.find(RankLogEntry, { where: { puuid }, order: { id: 'ASC' } })
  const gameRow = async (gameId: number) =>
    (await dataSource.manager.findOneBy(RankLogEntry, { gameId, puuid: 'self' }))!

  return {
    client,
    remote,
    clock,
    listeners,
    logger,
    settings,
    state,
    entryLoader,
    loadSnapshots,
    loadHistory,
    controller: createController(),
    createController,
    rows,
    gameRow,
    /** Plays one tracked ranked game to its end on this client. */
    play(controller: RankLogController, gameId: number, queueId = 420) {
      controller.trackGameflow('InProgress', session(gameId, queueId))
      controller.trackGameflow('EndOfGame', session(gameId, queueId))
    }
  }
}

afterEach(async () => {
  vi.useRealTimers()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

describe.skipIf(!isSqliteAvailable)('RankLogController', () => {
  describe('first contact', () => {
    it('records a starting point and refills the ranked games already in history', async () => {
      const harness = await createHarness()
      harness.remote.snapshots = [
        rank(),
        rank({ queueType: 'RANKED_FLEX_SR', provisional: true, wins: 2, losses: 1 })
      ]
      harness.remote.history = [
        game(12, START - 60 * MINUTE, { win: false }),
        game(11, START - 120 * MINUTE)
      ]

      await expect(harness.controller.sync()).resolves.toEqual({
        result: 'ok',
        historyLoaded: true
      })

      const rows = await harness.rows()
      expect(rows.map((row) => [row.kind, row.queueType, row.gameId])).toEqual([
        ['game', 'RANKED_SOLO_5x5', 12],
        ['game', 'RANKED_SOLO_5x5', 11],
        ['baseline', 'RANKED_SOLO_5x5', null],
        ['baseline', 'RANKED_FLEX_SR', null]
      ])
      expect(rows[0]).toMatchObject({
        occurredAt: START - 60 * MINUTE,
        observedAt: null,
        win: false,
        championId: 103,
        lpDelta: null,
        tier: null
      })
      expect(rows[2]).toMatchObject({
        occurredAt: START,
        observedAt: START,
        tier: 'GOLD',
        division: 'II',
        leaguePoints: 40,
        absoluteLp: 1440,
        wins: 10,
        losses: 8,
        lpDelta: null
      })
      expect(rows[3]).toMatchObject({
        tier: 'GOLD',
        provisional: true,
        absoluteLp: null,
        wins: 2,
        losses: 1
      })
      expect(harness.loadHistory).toHaveBeenCalledWith(
        { puuid: 'self', sgpServerId: 'NA1' },
        RANK_LOG_HISTORY_FULL_COUNT
      )
      expect(harness.state.revision).toBeGreaterThan(0)
      expect(harness.state.lastSyncedAt).toBe(START)
      expect(harness.state.syncing).toBe(false)
    })

    it('writes nothing new when nothing changed', async () => {
      const harness = await createHarness()
      harness.remote.history = [game(11, START - 120 * MINUTE)]
      await harness.controller.sync()
      const revision = harness.state.revision

      harness.clock.now += 5 * MINUTE
      await harness.controller.sync()
      await harness.controller.observe()

      expect(await harness.rows()).toHaveLength(2)
      expect(harness.state.revision).toBe(revision)
    })

    it('never ties a game from before the starting point to a later change', async () => {
      const harness = await createHarness()
      harness.remote.history = [game(11, START - 120 * MINUTE)]
      await harness.controller.sync()

      harness.clock.now += 40 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 61 })]
      harness.remote.isHistoryAvailable = false
      await harness.controller.observe()

      expect(await harness.gameRow(11)).toMatchObject({ observedAt: null, lpDelta: null })
      expect((await harness.rows()).at(-1)).toMatchObject({
        kind: 'game',
        gameId: null,
        win: true,
        lpDelta: 21
      })
    })
  })

  describe('a game played with the program running', () => {
    it('ties the rank change to the game it watched, then fills in the match details', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      harness.play(harness.controller, 501)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 62 })]
      await harness.controller.observe()

      expect(await harness.gameRow(501)).toMatchObject({
        kind: 'game',
        queueType: 'RANKED_SOLO_5x5',
        win: true,
        lpDelta: 22,
        tier: 'GOLD',
        division: 'II',
        leaguePoints: 62,
        absoluteLp: 1462,
        wins: 11,
        losses: 8,
        observedAt: START + 30 * MINUTE,
        championId: null
      })

      harness.remote.history = [game(501, START + 29 * MINUTE, { championId: 238, kills: 11 })]
      await harness.controller.sync(RANK_LOG_HISTORY_RECENT_COUNT)

      const rows = await harness.rows()
      expect(rows.filter((row) => row.kind === 'game')).toHaveLength(1)
      expect(await harness.gameRow(501)).toMatchObject({
        occurredAt: START + 29 * MINUTE,
        championId: 238,
        kills: 11,
        win: true,
        lpDelta: 22,
        absoluteLp: 1462
      })
    })

    it('finds the same row when history arrives before the rank changes', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      harness.play(harness.controller, 502)
      harness.clock.now += 30 * MINUTE
      harness.remote.history = [game(502, START + 29 * MINUTE, { win: false })]
      await harness.controller.sync(RANK_LOG_HISTORY_RECENT_COUNT)
      expect(await harness.gameRow(502)).toMatchObject({ observedAt: null, win: false })

      harness.clock.now += MINUTE
      harness.remote.snapshots = [rank({ division: 'III', leaguePoints: 81, losses: 9 })]
      await harness.controller.observe()

      expect(await harness.gameRow(502)).toMatchObject({
        win: false,
        lpDelta: -59,
        division: 'III',
        leaguePoints: 81,
        observedAt: START + 31 * MINUTE,
        championId: 103
      })
      expect((await harness.rows()).filter((row) => row.kind === 'game')).toHaveLength(1)
    })

    it('keeps the result but no points during placements', async () => {
      const harness = await createHarness()
      harness.remote.snapshots = [rank({ provisional: true, wins: 1, losses: 1 })]
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      harness.play(harness.controller, 503)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ provisional: true, wins: 2, losses: 1 })]
      await harness.controller.observe()

      expect(await harness.gameRow(503)).toMatchObject({
        win: true,
        lpDelta: null,
        absoluteLp: null,
        provisional: true,
        tier: 'GOLD'
      })
    })

    it('keeps solo and flex games apart', async () => {
      const harness = await createHarness()
      harness.remote.snapshots = [rank(), rank({ queueType: 'RANKED_FLEX_SR', tier: 'SILVER' })]
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      harness.play(harness.controller, 504, 440)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [
        rank(),
        rank({ queueType: 'RANKED_FLEX_SR', tier: 'SILVER', losses: 9, leaguePoints: 22 })
      ]
      await harness.controller.observe()

      expect(await harness.gameRow(504)).toMatchObject({
        queueType: 'RANKED_FLEX_SR',
        win: false,
        lpDelta: -18,
        tier: 'SILVER'
      })
    })

    it('does not hand a change to a game that is still running', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      harness.controller.trackGameflow('InProgress', session(505))

      harness.clock.now += 10 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      harness.remote.isHistoryAvailable = false
      await harness.controller.observe()

      expect(await harness.gameRow(505)).toBeNull()
      expect((await harness.rows()).at(-1)).toMatchObject({
        kind: 'game',
        gameId: null,
        lpDelta: 20
      })
    })

    it('treats a reconnect as the same unfinished game', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.controller.trackGameflow('InProgress', session(506))
      harness.controller.trackGameflow('None', null)
      harness.controller.trackGameflow('Reconnect', session(506))

      harness.clock.now += 10 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      harness.remote.isHistoryAvailable = false
      await harness.controller.observe()
      expect(await harness.gameRow(506)).toBeNull()

      harness.controller.trackGameflow('EndOfGame', session(506))
      harness.clock.now += 20 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, losses: 9, leaguePoints: 40 })]
      await harness.controller.observe()
      expect(await harness.gameRow(506)).toMatchObject({ win: false, lpDelta: -20 })
    })

    it.each([
      ['a normal game', session(507, 430)],
      ['a game somebody else is playing', session(507, 420, 'stranger')],
      ['a session without a game', null]
    ])('does not track %s', async (_, gameSession) => {
      const harness = await createHarness()
      await harness.controller.sync()
      harness.controller.trackGameflow('InProgress', gameSession)
      harness.controller.trackGameflow('EndOfGame', gameSession)

      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      harness.remote.isHistoryAvailable = false
      await harness.controller.observe()

      expect(await harness.gameRow(507)).toBeNull()
      expect(harness.loadSnapshots).toHaveBeenCalledTimes(2)
    })

    it('hands two finished games their changes in the order they were played', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.play(harness.controller, 508)
      harness.clock.now += 30 * MINUTE
      harness.play(harness.controller, 509)

      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      await harness.controller.observe()
      harness.clock.now += MINUTE
      harness.remote.snapshots = [rank({ wins: 11, losses: 9, leaguePoints: 41 })]
      await harness.controller.observe()

      expect(await harness.gameRow(508)).toMatchObject({ win: true, lpDelta: 20 })
      expect(await harness.gameRow(509)).toMatchObject({ win: false, lpDelta: -19 })
    })

    it('uses the known results to match two finished games', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.play(harness.controller, 510)
      harness.clock.now += 30 * MINUTE
      harness.play(harness.controller, 511)
      harness.remote.history = [
        game(511, START + 29 * MINUTE),
        game(510, START - MINUTE, { win: false })
      ]
      await harness.controller.sync(RANK_LOG_HISTORY_RECENT_COUNT)

      // 先到的是一场胜利的变化：只能属于 511。
      harness.clock.now += MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      await harness.controller.observe()

      expect(await harness.gameRow(511)).toMatchObject({ win: true, lpDelta: 20 })
      expect(await harness.gameRow(510)).toMatchObject({
        win: false,
        lpDelta: null,
        observedAt: null
      })
    })

    it('forgets a finished game that never got a change', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.play(harness.controller, 512)

      harness.clock.now += RANK_LOG_TRACKED_GAME_TTL_MS + MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      harness.remote.isHistoryAvailable = false
      await harness.controller.observe()

      expect(await harness.gameRow(512)).toBeNull()
      expect((await harness.rows()).at(-1)).toMatchObject({ kind: 'game', gameId: null })
    })
  })

  describe('remakes', () => {
    it('drops a remade game so the next change goes to the real game', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.play(harness.controller, 601)
      harness.clock.now += 5 * MINUTE
      harness.remote.history = [game(601, START + 4 * MINUTE, { remake: true, win: false })]
      await harness.controller.sync(RANK_LOG_HISTORY_RECENT_COUNT)

      harness.play(harness.controller, 602)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ losses: 9, leaguePoints: 20 })]
      await harness.controller.observe()

      expect(await harness.gameRow(601)).toMatchObject({
        remake: true,
        lpDelta: null,
        observedAt: null
      })
      expect(await harness.gameRow(602)).toMatchObject({ win: false, lpDelta: -20 })
    })

    it('moves a change off a remake once history shows what it was', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.remote.isHistoryAvailable = false
      harness.play(harness.controller, 603)
      harness.clock.now += 5 * MINUTE
      harness.play(harness.controller, 604)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 61 })]
      await harness.controller.observe()
      // 战绩读不到时，变化先落在最早结束的那一局（其实是重开）上。
      expect(await harness.gameRow(603)).toMatchObject({ win: true, lpDelta: 21 })

      harness.remote.isHistoryAvailable = true
      harness.remote.history = [
        game(604, START + 34 * MINUTE),
        game(603, START + 4 * MINUTE, { remake: true, win: false })
      ]
      harness.clock.now += MINUTE
      await harness.controller.sync(RANK_LOG_HISTORY_RECENT_COUNT)

      expect(await harness.gameRow(603)).toMatchObject({
        remake: true,
        win: false,
        lpDelta: null,
        observedAt: null,
        tier: null
      })
      expect(await harness.gameRow(604)).toMatchObject({
        win: true,
        lpDelta: 21,
        leaguePoints: 61,
        observedAt: START + 35 * MINUTE
      })
      expect(
        (await harness.rows()).filter((row) => row.gameId === null && row.kind === 'game')
      ).toEqual([])
      expect(harness.logger.warn).toHaveBeenCalledWith(expect.stringContaining('603'))
    })

    it('detaches a change when history reports the opposite result', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.remote.isHistoryAvailable = false
      harness.play(harness.controller, 605)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 61 })]
      await harness.controller.observe()

      harness.remote.isHistoryAvailable = true
      harness.remote.history = [game(605, START + 29 * MINUTE, { win: false })]
      await harness.controller.sync(RANK_LOG_HISTORY_RECENT_COUNT)

      expect(await harness.gameRow(605)).toMatchObject({
        win: false,
        lpDelta: null,
        observedAt: null
      })
      expect((await harness.rows()).at(-1)).toMatchObject({
        kind: 'game',
        gameId: null,
        win: true,
        lpDelta: 21,
        observedAt: START + 30 * MINUTE,
        occurredAt: START + 30 * MINUTE
      })
    })
  })

  describe('games played while the program was closed', () => {
    it('recognises the single game that ended since the last reading', async () => {
      const harness = await createHarness()
      await harness.controller.sync()

      // 重新启动：没有任何亲眼看到的对局。
      const restarted = harness.createController()
      harness.clock.now += 3 * 60 * MINUTE
      harness.remote.history = [game(701, START + 40 * MINUTE, { win: false })]
      harness.remote.snapshots = [rank({ losses: 9, leaguePoints: 19 })]
      await restarted.sync()

      expect(await harness.gameRow(701)).toMatchObject({
        win: false,
        lpDelta: -21,
        leaguePoints: 19,
        occurredAt: START + 40 * MINUTE,
        observedAt: START + 3 * 60 * MINUTE
      })
      expect(harness.loadHistory).toHaveBeenCalledTimes(2)
    })

    it('reads history before deciding when the change arrives on its own', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      harness.clock.now += 60 * MINUTE
      harness.remote.history = [game(702, START + 40 * MINUTE)]
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 63 })]

      await harness.controller.observe()

      expect(await harness.gameRow(702)).toMatchObject({ win: true, lpDelta: 23 })
      expect(harness.loadHistory).toHaveBeenLastCalledWith(
        expect.anything(),
        RANK_LOG_HISTORY_RECENT_COUNT
      )
    })

    it('keeps the change unidentified until history can be read, then merges it', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      harness.clock.now += 60 * MINUTE
      harness.remote.isHistoryReadable = false
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 63 })]
      await harness.controller.observe()

      const pending = (await harness.rows()).at(-1)!
      expect(pending).toMatchObject({ kind: 'game', gameId: null, win: true, lpDelta: 23 })
      expect(harness.logger.warn).toHaveBeenCalledWith(expect.stringContaining('history'))

      harness.remote.isHistoryReadable = true
      harness.remote.history = [game(703, START + 40 * MINUTE)]
      harness.clock.now += 10 * MINUTE
      await harness.controller.sync()

      const rows = await harness.rows()
      expect(rows.find((row) => row.id === pending.id)).toBeUndefined()
      expect(rows.filter((row) => row.kind === 'game')).toHaveLength(1)
      expect(await harness.gameRow(703)).toMatchObject({
        win: true,
        lpDelta: 23,
        leaguePoints: 63,
        observedAt: START + 60 * MINUTE,
        occurredAt: START + 40 * MINUTE,
        championId: 103
      })
    })

    it('refuses to guess between two games that both fit', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      harness.clock.now += 3 * 60 * MINUTE
      harness.remote.history = [game(705, START + 90 * MINUTE), game(704, START + 40 * MINUTE)]
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 63 })]
      await harness.controller.sync()

      expect(await harness.gameRow(704)).toMatchObject({ lpDelta: null, observedAt: null })
      expect(await harness.gameRow(705)).toMatchObject({ lpDelta: null, observedAt: null })
      expect((await harness.rows()).at(-1)).toMatchObject({
        kind: 'game',
        gameId: null,
        lpDelta: 23
      })
    })

    it('ignores a game with the other result and a remake when picking', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      harness.clock.now += 3 * 60 * MINUTE
      harness.remote.history = [
        game(708, START + 120 * MINUTE, { remake: true }),
        game(707, START + 90 * MINUTE, { win: false }),
        game(706, START + 40 * MINUTE)
      ]
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 63 })]
      await harness.controller.sync()

      expect(await harness.gameRow(706)).toMatchObject({ lpDelta: 23 })
      expect(await harness.gameRow(707)).toMatchObject({ lpDelta: null })
      expect(await harness.gameRow(708)).toMatchObject({ lpDelta: null })
    })

    it('folds several unseen games into one gap and leaves each game without points', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.play(harness.controller, 709)
      harness.clock.now += 5 * 60 * MINUTE
      harness.remote.history = [
        game(710, START + 4 * 60 * MINUTE),
        game(709, START + 60 * MINUTE, { win: false })
      ]
      harness.remote.snapshots = [rank({ wins: 11, losses: 9, leaguePoints: 43 })]
      await harness.controller.sync()

      const rows = await harness.rows()
      expect(rows.at(-1)).toMatchObject({
        kind: 'gap',
        games: 2,
        lpDelta: 3,
        gameId: null,
        wins: 11,
        losses: 9,
        leaguePoints: 43
      })
      expect(await harness.gameRow(709)).toMatchObject({ lpDelta: null, observedAt: null })

      // 之后新的一局不会被漏记里的旧对局抢走。
      harness.play(harness.controller, 711)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 12, losses: 9, leaguePoints: 64 })]
      await harness.controller.observe()
      expect(await harness.gameRow(711)).toMatchObject({ win: true, lpDelta: 21 })
      expect(await harness.gameRow(709)).toMatchObject({ lpDelta: null })
    })
  })

  describe('changes without a game', () => {
    it('records a dodge penalty or decay as an adjustment', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      harness.clock.now += 10 * MINUTE
      harness.remote.snapshots = [rank({ leaguePoints: 35 })]
      await harness.controller.observe()

      expect((await harness.rows()).at(-1)).toMatchObject({
        kind: 'adjustment',
        lpDelta: -5,
        leaguePoints: 35,
        wins: 10,
        losses: 8,
        games: null,
        gameId: null,
        occurredAt: START + 10 * MINUTE
      })
      expect(harness.loadHistory).toHaveBeenCalledTimes(1)
    })

    it('starts over once the counters of a new season show up', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.clock.now += 10 * MINUTE
      // 新赛季第一局定位赛之后：计数比之前小。
      harness.play(harness.controller, 802)
      harness.remote.snapshots = [rank({ provisional: true, wins: 1, losses: 0 })]
      await harness.controller.observe()

      expect((await harness.rows()).at(-1)).toMatchObject({
        kind: 'baseline',
        lpDelta: null,
        provisional: true,
        absoluteLp: null,
        wins: 1,
        losses: 0
      })

      // 起点之后的下一局照常逐局记录，之前打完的那一局不再认领。
      harness.play(harness.controller, 803)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ provisional: true, wins: 1, losses: 1 })]
      await harness.controller.observe()
      expect(await harness.gameRow(803)).toMatchObject({ win: false, lpDelta: null })
      expect(await harness.gameRow(802)).toBeNull()
    })

    it('neither records nor trusts an all-empty reading', async () => {
      const harness = await createHarness()
      const empty = rank({ tier: '', division: 'NA', leaguePoints: 0, wins: 0, losses: 0 })

      // 客户端刚启动：先是空的，然后才是真数据。
      harness.remote.snapshots = [empty]
      await harness.controller.sync()
      expect(await harness.rows()).toEqual([])
      harness.remote.snapshots = [rank()]
      await harness.controller.observe()
      expect((await harness.rows()).map((row) => row.kind)).toEqual(['baseline'])

      // 之后闪回一次空数据：不记录，也不打断后面这一局的胜点。
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.play(harness.controller, 804)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [empty]
      await harness.controller.observe()
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 61 })]
      await harness.controller.observe()

      const rows = await harness.rows()
      expect(rows.map((row) => row.kind)).toEqual(['baseline', 'game'])
      expect(await harness.gameRow(804)).toMatchObject({ win: true, lpDelta: 21 })
    })

    it('uses the adjustment as the reference for the next game', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.clock.now += 10 * MINUTE
      harness.remote.snapshots = [rank({ leaguePoints: 35 })]
      await harness.controller.observe()

      harness.play(harness.controller, 801)
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 57 })]
      await harness.controller.observe()

      expect(await harness.gameRow(801)).toMatchObject({ lpDelta: 22 })
    })
  })

  describe('guards', () => {
    it('does nothing while switched off', async () => {
      const harness = await createHarness()
      harness.settings.setEnabled(false)

      await expect(harness.controller.sync()).resolves.toEqual({
        result: 'failed',
        reason: 'disabled',
        historyLoaded: false
      })
      await harness.controller.observe()
      harness.controller.trackGameflow('InProgress', session(901))

      expect(await harness.rows()).toEqual([])
      expect(harness.loadSnapshots).not.toHaveBeenCalled()
      expect(harness.loadHistory).not.toHaveBeenCalled()
    })

    it('reports an unavailable table and a missing account', async () => {
      const harness = await createHarness()
      harness.state.setAvailable(false)
      await expect(harness.controller.sync()).resolves.toMatchObject({ reason: 'unavailable' })

      harness.state.setAvailable(true)
      runInAction(() => (harness.client.puuid = null))
      await expect(harness.controller.sync()).resolves.toMatchObject({ reason: 'not-connected' })
      expect(harness.loadSnapshots).not.toHaveBeenCalled()
    })

    it('still refills history when the rank cannot be read', async () => {
      const harness = await createHarness()
      harness.remote.isRankReadable = false
      harness.remote.history = [game(902, START - 60 * MINUTE)]

      await expect(harness.controller.sync()).resolves.toEqual({
        result: 'failed',
        reason: 'rank-unreadable',
        historyLoaded: true
      })

      expect((await harness.rows()).map((row) => row.gameId)).toEqual([902])
      expect(harness.state.syncing).toBe(false)
    })

    it('reads the rank even when the region has no history service', async () => {
      const harness = await createHarness()
      harness.remote.isHistoryAvailable = false

      await expect(harness.controller.sync()).resolves.toEqual({
        result: 'ok',
        historyLoaded: false
      })

      expect((await harness.rows()).map((row) => row.kind)).toEqual(['baseline'])
      expect(harness.loadHistory).not.toHaveBeenCalled()
      expect(harness.state.lastSyncedAt).toBe(0)
    })

    it('throws away a reading that came back after the account changed', async () => {
      const harness = await createHarness()
      harness.loadSnapshots.mockImplementationOnce(async () => {
        runInAction(() => (harness.client.puuid = 'second'))
        return [rank()]
      })

      await harness.controller.observe()

      expect(await harness.rows()).toEqual([])
      expect(await harness.rows('second')).toEqual([])
    })

    it('keeps every account in its own log', async () => {
      const harness = await createHarness()
      harness.remote.history = [game(903, START - 60 * MINUTE)]
      await harness.controller.sync()

      runInAction(() => (harness.client.puuid = 'second'))
      harness.remote.history = []
      harness.remote.snapshots = [rank({ tier: 'SILVER', wins: 3, losses: 3 })]
      await harness.controller.sync()

      expect((await harness.rows()).map((row) => row.kind)).toEqual(['game', 'baseline'])
      expect(await harness.rows('second')).toMatchObject([{ kind: 'baseline', tier: 'SILVER' }])
      expect(await harness.entryLoader.query({ puuid: 'second', sgpServerId: 'NA1' })).toHaveLength(
        1
      )
      expect(await harness.entryLoader.query({ puuid: 'self', sgpServerId: 'EUW1' })).toEqual([])
    })

    it('runs overlapping requests one after another', async () => {
      const harness = await createHarness()
      harness.remote.history = [game(904, START - 60 * MINUTE)]

      await Promise.all([
        harness.controller.sync(),
        harness.controller.observe(),
        harness.controller.observe(),
        harness.controller.sync()
      ])

      expect((await harness.rows()).map((row) => row.kind)).toEqual(['game', 'baseline'])
      // 两次同步各读一次，排队中的两次读数合并成一次。
      expect(harness.loadSnapshots).toHaveBeenCalledTimes(3)
    })

    it('keeps working after one step failed', async () => {
      const harness = await createHarness()
      harness.loadSnapshots.mockImplementationOnce(async () => {
        throw new Error('boom')
      })
      await harness.controller.observe()
      expect(await harness.rows()).toEqual([])

      await harness.controller.observe()
      expect((await harness.rows()).map((row) => row.kind)).toEqual(['baseline'])
    })
  })

  describe('after a game ends', () => {
    it('keeps reading until the change and the match details are both in', async () => {
      const harness = await createHarness()
      await harness.controller.sync()
      harness.loadSnapshots.mockClear()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.play(harness.controller, 1001)

      // 第一次：段位还没更新。
      await vi.advanceTimersByTimeAsync(RANK_LOG_FOLLOW_UP_DELAYS_MS[0])
      await harness.controller.observe()
      expect(harness.loadSnapshots).toHaveBeenCalledTimes(2)
      expect(await harness.gameRow(1001)).toBeNull()

      // 第二次：段位更新了，战绩还没有。
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      await vi.advanceTimersByTimeAsync(
        RANK_LOG_FOLLOW_UP_DELAYS_MS[1] - RANK_LOG_FOLLOW_UP_DELAYS_MS[0]
      )
      await harness.controller.observe()
      expect(await harness.gameRow(1001)).toMatchObject({ lpDelta: 20, championId: null })

      // 第三次：战绩也到了，之后不再读。
      harness.remote.history = [game(1001, START)]
      await vi.advanceTimersByTimeAsync(
        RANK_LOG_FOLLOW_UP_DELAYS_MS[2] - RANK_LOG_FOLLOW_UP_DELAYS_MS[1]
      )
      await harness.controller.observe()
      expect(await harness.gameRow(1001)).toMatchObject({ lpDelta: 20, championId: 103 })
      const calls = harness.loadSnapshots.mock.calls.length

      await vi.advanceTimersByTimeAsync(RANK_LOG_FOLLOW_UP_DELAYS_MS.at(-1)!)
      await harness.controller.observe()
      expect(harness.loadSnapshots).toHaveBeenCalledTimes(calls + 1)
    })
  })

  describe('wiring', () => {
    it('syncs when an account is ready and follows the client by itself', async () => {
      const harness = await createHarness()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.controller.watch()
      await harness.controller.observe()
      expect((await harness.rows()).map((row) => row.kind)).toEqual(['baseline'])

      runInAction(() => {
        harness.client.session = session(1101)
        harness.client.phase = 'InProgress'
      })
      runInAction(() => (harness.client.phase = 'WaitingForStats'))
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      harness.listeners.get('/lol-ranked/v1/current-ranked-stats')!({ data: {} })
      await harness.controller.observe()

      expect(await harness.gameRow(1101)).toMatchObject({ win: true, lpDelta: 20 })
    })

    it('forgets watched games when the account changes', async () => {
      const harness = await createHarness()
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
      harness.controller.watch()
      await harness.controller.observe()
      runInAction(() => {
        harness.client.session = session(1102)
        harness.client.phase = 'InProgress'
      })
      runInAction(() => (harness.client.phase = 'EndOfGame'))

      runInAction(() => (harness.client.puuid = 'second'))
      await harness.controller.observe()
      harness.clock.now += 30 * MINUTE
      harness.remote.snapshots = [rank({ wins: 11, leaguePoints: 60 })]
      harness.remote.isHistoryAvailable = false
      await harness.controller.observe()

      expect((await harness.rows('second')).map((row) => [row.kind, row.gameId])).toEqual([
        ['baseline', null],
        ['game', null]
      ])
    })

    it('logs only the field names of an LP change notification, three times at most', async () => {
      const harness = await createHarness()
      harness.controller.watch()
      await harness.controller.observe()
      harness.logger.info.mockClear()
      const notify = harness.listeners.get('/lol-ranked/v1/current-lp-change-notification')!

      notify({ data: null })
      for (let index = 0; index < 5; index++) {
        notify({ data: { leaguePointsDelta: -17, tier: 'GOLD', consolationLp: null } })
      }

      const messages = harness.logger.info.mock.calls.map(([message]) => String(message))
      expect(messages).toHaveLength(3)
      expect(messages[0]).toContain('leaguePointsDelta:number, tier:string, consolationLp:null')
      expect(messages.join()).not.toContain('17')
      expect(messages.join()).not.toContain('GOLD')
    })
  })
})

describe.skipIf(!isSqliteAvailable)('RankLogEntryLoader.query', () => {
  it('returns the newest rows first, filtered by queue and capped', async () => {
    const harness = await createHarness()
    harness.remote.snapshots = [rank(), rank({ queueType: 'RANKED_FLEX_SR' })]
    harness.remote.history = [
      game(13, START - 10 * MINUTE),
      game(12, START - 60 * MINUTE, { queueType: 'RANKED_FLEX_SR' }),
      game(11, START - 120 * MINUTE)
    ]
    await harness.controller.sync()
    const owner = { puuid: 'self', sgpServerId: 'NA1' }

    const all = await harness.entryLoader.query(owner)
    expect(all.map((entry) => [entry.kind, entry.gameId])).toEqual([
      ['baseline', null],
      ['baseline', null],
      ['game', 13],
      ['game', 12],
      ['game', 11]
    ])
    expect(all[0]).not.toHaveProperty('puuid')
    expect(all[0]).not.toHaveProperty('sgpServerId')

    const flex = await harness.entryLoader.query({ ...owner, queueType: 'RANKED_FLEX_SR' })
    expect(flex.map((entry) => entry.gameId)).toEqual([null, 12])
    expect(await harness.entryLoader.query({ ...owner, limit: 2 })).toHaveLength(2)
  })
})
