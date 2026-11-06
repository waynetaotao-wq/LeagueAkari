import { QueueKeeper } from '@shared/utils/queue-keeper'
import { observable, reaction, runInAction } from 'mobx'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getLiveQueryStage } from './computed-state'
import type { OngoingGameMainContext } from './context'
import { OngoingGameDraftHistoryLoader } from './draft-history-loader'

vi.mock('@main/native', () => ({ magic: vi.fn() }))

const cleanups: Array<() => void> = []
afterEach(async () => {
  cleanups.splice(0).forEach((dispose) => dispose())
  await Promise.resolve()
  vi.useRealTimers()
})

function harness(source: 'sgp' | 'lcu' = 'sgp') {
  vi.useFakeTimers()
  const member = (index: number) => ({
    puuid: `player-${index}`,
    gameName: `Player ${index}`,
    tagLine: 'TEST',
    cellId: index,
    nameVisibilityType: 'VISIBLE',
    obfuscatedPuuid: '',
    championId: 0
  })
  const data = observable({
    champSelect: {
      session: {
        id: 'draft-one',
        gameId: 0,
        queueId: 710,
        isSpectating: false,
        isCustomGame: false,
        localPlayerCellId: 0,
        myTeam: Array.from({ length: 5 }, (_, i) => member(i)),
        theirTeam: Array.from({ length: 5 }, (_, i) => member(i + 5))
      }
    },
    summoner: { me: { puuid: 'player-0' } },
    lobby: { lobby: { gameConfig: { queueId: 440 } } },
    gameflow: {
      session: {
        phase: 'ChampSelect',
        gameData: {
          gameId: 0,
          queue: { id: 710, gameMode: 'CLASSIC', type: 'RANKED_PREMADE_5x5' }
        }
      }
    }
  })
  const settings = observable({
    enabled: true,
    queryInLobbyPhase: true,
    matchHistoryTagPreference: 'all',
    matchHistoryLoadCount: 1
  })
  const state = observable({
    draft: null as unknown,
    apiShouldUse: source,
    get queryStage() {
      return getLiveQueryStage({ data: data as any, settings })
    },
    draftMatchHistory: {} as OngoingGameMainContext['state']['draftMatchHistory'],
    draftMatchHistoryLoadingState:
      {} as OngoingGameMainContext['state']['draftMatchHistoryLoadingState'],
    matchHistory: { unrelated: { data: ['preserve'] } },
    matchHistoryTagParams: { tag: undefined }
  })
  const sgpApi = vi.fn().mockResolvedValue({ data: { games: [] } })
  const lcuApi = vi.fn().mockResolvedValue({ data: { games: { games: [] } } })
  const queueKeeper = new QueueKeeper([{ id: 'match-history', options: { concurrency: 2 } }])
  const connection = observable({ isConnected: true, auth: { region: 'NA', rsoPlatformId: 'NA1' } })
  const token = observable({ isTokenReady: true })
  const sendEvent = vi.fn()
  const disposers: Array<() => void> = []
  const context = {
    settings,
    state,
    queueKeeper,
    leagueClient: { data, state: connection, api: { matchHistory: { getMatchHistory: lcuApi } } },
    sgp: {
      state: token,
      api: { matchHistoryQuery: { getMatchHistorySummaryByPlayerPuuid: sgpApi } }
    },
    ipc: { sendEvent },
    logger: { warn: vi.fn() },
    mobxUtils: {
      reaction: (...args: Parameters<typeof reaction>) => disposers.push(reaction(...args))
    }
  } as unknown as OngoingGameMainContext
  const loader = new OngoingGameDraftHistoryLoader(context)
  cleanups.push(() => {
    disposers.forEach((dispose) => dispose())
    runInAction(() => {
      connection.isConnected = false
    })
    loader.update()
    queueKeeper.cancelAll()
  })
  return {
    loader,
    settings,
    state,
    data,
    sgpApi,
    lcuApi,
    queueKeeper,
    connection,
    token,
    sendEvent
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('visible premade draft history flow', () => {
  it('loads the self and all five visible enemies before picks, despite all-mode card filters and a stale lobby queue', async () => {
    const h = harness()
    h.loader.watch()
    await flush()
    expect(h.sgpApi.mock.calls.map((call) => call[0])).toEqual([
      'player-0',
      'player-5',
      'player-6',
      'player-7',
      'player-8',
      'player-9',
      'player-1',
      'player-2',
      'player-3',
      'player-4'
    ])
    expect(
      h.sgpApi.mock.calls.every((call) => call[1].tag === 'q_710' && call[1].count === 50)
    ).toBe(true)
    expect(Object.keys(h.state.draftMatchHistory)).toHaveLength(10)
    expect(h.settings.matchHistoryTagPreference).toBe('all')
    expect(h.settings.matchHistoryLoadCount).toBe(1)
    expect(h.state.matchHistory).toEqual({ unrelated: { data: ['preserve'] } })
    expect(h.state.matchHistoryTagParams).toEqual({ tag: undefined })
  })

  it('waits for public identity and token, then reads it without using obfuscated identities', async () => {
    const h = harness()
    runInAction(() => {
      h.data.champSelect.session.theirTeam[0].nameVisibilityType = 'HIDDEN'
      h.data.champSelect.session.theirTeam[1].puuid = ''
      h.token.isTokenReady = false
    })
    h.loader.watch()
    await flush()
    expect(h.sgpApi).not.toHaveBeenCalled()
    expect(h.state.draftMatchHistoryLoadingState['player-0']).toBe('waiting')
    runInAction(() => {
      h.token.isTokenReady = true
    })
    await flush()
    expect(h.sgpApi.mock.calls.map((c) => c[0])).not.toContain('player-5')
    expect(h.sgpApi.mock.calls.map((c) => c[0])).not.toContain('player-6')
    runInAction(() => {
      h.data.champSelect.session.theirTeam[1].puuid = 'player-6'
    })
    await flush()
    expect(h.sgpApi.mock.calls.filter((c) => c[0] === 'player-6')).toHaveLength(1)
    expect(h.sgpApi.mock.calls.filter((c) => c[0] === 'player-0')).toHaveLength(1)
  })

  it('cancels in-flight reads when authorization becomes unavailable and ignores their late results after recovery', async () => {
    const h = harness()
    const stale = deferred<any>()
    h.sgpApi.mockImplementation(() => stale.promise)
    h.loader.watch()
    await flush()
    const oldSignal = h.sgpApi.mock.calls[0][1].signal
    runInAction(() => {
      h.token.isTokenReady = false
    })
    await flush()
    expect(oldSignal.aborted).toBe(true)
    expect(h.state.draftMatchHistoryLoadingState['player-0']).toBe('waiting')

    h.sgpApi.mockResolvedValue({ data: { games: [] } })
    runInAction(() => {
      h.token.isTokenReady = true
    })
    await flush()
    stale.resolve({ data: { games: [{ json: { gameId: 99, queueId: 710 } }] } })
    await flush()
    expect(Object.keys(h.state.draftMatchHistory)).toHaveLength(10)
    expect(
      Object.values(h.state.draftMatchHistory).every((history) => history.data.length === 0)
    ).toBe(true)
    expect(h.state.draftMatchHistoryLoadingState['player-0']).toBe('loaded')
  })

  it.each([440, 720])('does not scout unsupported queue %s', async (queue) => {
    const h = harness()
    runInAction(() => {
      h.data.gameflow.session.gameData.queue.id = queue
      h.data.champSelect.session.queueId = queue
    })
    h.loader.watch()
    await flush()
    expect(h.sgpApi).not.toHaveBeenCalled()
  })

  it('clears the old queue and ignores late responses when entering Clash or leaving selection', async () => {
    const h = harness()
    const pending = deferred<any>()
    h.sgpApi.mockImplementation((_id, options) =>
      options.tag === 'q_710' ? pending.promise : Promise.resolve({ data: { games: [] } })
    )
    h.loader.watch()
    await flush()
    const oldSignal = h.sgpApi.mock.calls[0][1].signal
    runInAction(() => {
      h.data.champSelect.session.queueId = 700
      h.data.gameflow.session.gameData.queue.id = 700
    })
    await flush()
    expect(oldSignal.aborted).toBe(true)
    expect(
      Object.values(h.state.draftMatchHistory).every((history) => history.queueId === 700)
    ).toBe(true)
    pending.resolve({ data: { games: [{ json: { gameId: 99, queueId: 710 } }] } })
    await flush()
    expect(
      Object.values(h.state.draftMatchHistory).every((history) => history.data.length === 0)
    ).toBe(true)
    runInAction(() => {
      h.data.gameflow.session.phase = 'InProgress'
    })
    await flush()
    expect(h.state.draftMatchHistory).toEqual({})
    expect(h.state.draftMatchHistoryLoadingState).toEqual({})
    expect(h.sendEvent).toHaveBeenCalledWith('ongoing-game-main', 'draft-match-history-clear')
  })

  it('removes an identity that becomes hidden and excludes it from retries', async () => {
    const h = harness()
    h.loader.watch()
    await flush()
    runInAction(() => {
      h.data.champSelect.session.theirTeam[0].nameVisibilityType = 'HIDDEN'
    })
    await flush()
    h.sgpApi.mockClear()
    h.loader.update(true)
    await flush()
    expect(h.state.draftMatchHistory['player-5']).toBeUndefined()
    expect(h.sgpApi).not.toHaveBeenCalled()
    expect(h.sendEvent).toHaveBeenCalledWith(
      'ongoing-game-main',
      'draft-match-history-removed',
      'player-5'
    )
  })

  it('invalidates pending results on an account/server change and disables the channel with the feature', async () => {
    const h = harness()
    const old = deferred<any>()
    h.sgpApi.mockImplementation(() => old.promise)
    h.loader.watch()
    await flush()
    h.sgpApi.mockResolvedValue({ data: { games: [] } })
    runInAction(() => {
      h.connection.auth.rsoPlatformId = 'EUW1'
    })
    await flush()
    expect(Object.keys(h.state.draftMatchHistory)).toHaveLength(10)
    old.resolve({ data: { games: [{ json: { gameId: 999, queueId: 710 } }] } })
    await flush()
    expect(
      Object.values(h.state.draftMatchHistory).every((history) => history.data.length === 0)
    ).toBe(true)
    runInAction(() => {
      h.settings.enabled = false
    })
    await flush()
    expect(h.state.draftMatchHistory).toEqual({})
    h.sgpApi.mockClear()
    h.loader.update(true)
    await flush()
    expect(h.sgpApi).not.toHaveBeenCalled()
  })

  it('bounds queue waiting to 30 seconds and allows retry without accepting a timed-out response', async () => {
    const h = harness()
    h.queueKeeper.setConcurrency('match-history', 1)
    const blocker = deferred<void>()
    const task = h.queueKeeper.add('match-history', 'busy', () => blocker.promise)
    h.loader.watch()
    await vi.advanceTimersByTimeAsync(30_001)
    expect(h.sgpApi).not.toHaveBeenCalled()
    expect(
      Object.values(h.state.draftMatchHistoryLoadingState).every((status) => status === 'error')
    ).toBe(true)
    blocker.resolve()
    await task
    await flush()
    const late = deferred<any>()
    h.sgpApi.mockImplementation(() => late.promise)
    h.loader.update(true)
    await flush()
    await vi.advanceTimersByTimeAsync(30_001)
    late.resolve({ data: { games: [{ json: { gameId: 99, queueId: 710 } }] } })
    await flush()
    expect(h.state.draftMatchHistory).toEqual({})
    h.sgpApi.mockResolvedValue({ data: { games: [] } })
    h.loader.update(true)
    await flush()
    expect(
      Object.values(h.state.draftMatchHistoryLoadingState).every((status) => status === 'loaded')
    ).toBe(true)
  })

  it('pages LCU in groups of 20, preserves partial results on failure and retries only the failed player', async () => {
    const h = harness('lcu')
    h.lcuApi.mockImplementation((id, start) => {
      if (id !== 'player-5') return Promise.resolve({ data: { games: { games: [] } } })
      if (start === 20) return Promise.reject(new Error('network'))
      return Promise.resolve({
        data: {
          games: {
            games: Array.from({ length: 20 }, (_, i) => ({
              gameId: i + 1,
              queueId: i === 0 ? 710 : 420
            }))
          }
        }
      })
    })
    h.loader.watch()
    await flush()
    expect(h.state.draftMatchHistory['player-5']).toMatchObject({
      source: 'lcu',
      scannedCount: 20,
      scanLimit: 200,
      data: [{ gameId: 1 }]
    })
    expect(h.state.draftMatchHistoryLoadingState['player-5']).toBe('error')
    expect(
      h.lcuApi.mock.calls.filter((c) => c[0] === 'player-5').map((c) => c.slice(1, 3))
    ).toEqual([
      [0, 19],
      [20, 39]
    ])
    expect(
      h.sendEvent.mock.calls.some(
        (c) => c[1] === 'draft-match-history-loaded' && c[2] === 'player-5'
      )
    ).toBe(true)
    h.lcuApi.mockClear()
    h.lcuApi.mockResolvedValue({ data: { games: { games: [] } } })
    h.loader.update(true)
    await flush()
    expect(h.lcuApi).toHaveBeenCalledTimes(1)
    expect(h.lcuApi.mock.calls[0][0]).toBe('player-5')
  })

  it('stops LCU scanning after 200 records and never borrows another queue as the player pool', async () => {
    const h = harness('lcu')
    h.lcuApi.mockImplementation((_id, start) =>
      Promise.resolve({
        data: {
          games: {
            games: Array.from({ length: 20 }, (_, i) => ({ gameId: start + i + 1, queueId: 420 }))
          }
        }
      })
    )
    h.loader.watch()
    await flush()
    expect(h.lcuApi.mock.calls.filter((c) => c[0] === 'player-5')).toHaveLength(10)
    expect(h.state.draftMatchHistory['player-5']).toMatchObject({ scannedCount: 200, data: [] })
  })

  it('continues within the LCU scan budget when early mode records are unusable for the hero pool', async () => {
    const h = harness('lcu')
    h.lcuApi.mockImplementation((id, start) =>
      Promise.resolve({
        data: {
          games: {
            games:
              id !== 'player-5' || start >= 80
                ? []
                : Array.from({ length: 20 }, (_, index) => ({
                    gameId: start + index + 1,
                    queueId: 710,
                    mapId: 11,
                    gameMode: 'CLASSIC',
                    gameCreation: Date.now() - 86_400_000,
                    gameDuration: start < 60 ? 180 : 1800,
                    endOfGameResult: start < 60 ? 'Remake' : 'GameComplete',
                    participantIdentities: [{ participantId: 1, player: { puuid: id } }],
                    participants: [{ participantId: 1, championId: 103, stats: { win: true } }]
                  }))
          }
        }
      })
    )
    h.loader.watch()
    await flush()
    expect(h.state.draftMatchHistory['player-5'].data.some((row) => row.gameId === 61)).toBe(true)
    expect(h.state.draftMatchHistory['player-5'].scannedCount).toBe(80)
    expect(h.state.draftMatchHistoryLoadingState['player-5']).toBe('loaded')
  })

  it('resumes failed LCU pages without replacing the previously read pool with an earlier page', async () => {
    const h = harness('lcu')
    const page = (start: number) => ({
      data: {
        games: {
          games: Array.from({ length: 20 }, (_, index) => ({
            gameId: start + index + 1,
            queueId: 710
          }))
        }
      }
    })
    h.lcuApi.mockImplementation((id, start) => {
      if (id !== 'player-5') return Promise.resolve({ data: { games: { games: [] } } })
      return start === 40 ? Promise.reject(new Error('network')) : Promise.resolve(page(start))
    })
    h.loader.watch()
    await flush()
    expect(h.state.draftMatchHistory['player-5'].data).toHaveLength(40)

    h.lcuApi.mockClear()
    h.lcuApi.mockImplementation((_id, start) =>
      start === 0 ? Promise.resolve(page(0)) : Promise.reject(new Error('still unavailable'))
    )
    h.loader.update(true)
    await flush()
    expect(h.state.draftMatchHistory['player-5'].data).toHaveLength(40)
    expect(h.state.draftMatchHistory['player-5'].scannedCount).toBe(40)
    expect(h.lcuApi.mock.calls.map((call) => call.slice(1, 3))).toEqual([[40, 59]])
    expect(h.state.draftMatchHistoryLoadingState['player-5']).toBe('error')

    h.lcuApi.mockClear()
    h.lcuApi.mockImplementation((_id, start) =>
      Promise.resolve(start === 40 ? page(40) : { data: { games: { games: [] } } })
    )
    h.loader.update(true)
    await flush()
    expect(h.state.draftMatchHistory['player-5'].data).toHaveLength(60)
    expect(h.state.draftMatchHistory['player-5'].scannedCount).toBe(60)
    expect(h.lcuApi.mock.calls.map((call) => call.slice(1, 3))).toEqual([
      [40, 59],
      [60, 79]
    ])
    expect(h.state.draftMatchHistoryLoadingState['player-5']).toBe('loaded')
  })
})
