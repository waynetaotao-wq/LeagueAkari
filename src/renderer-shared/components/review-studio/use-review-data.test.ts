import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import type { SummonerInfo } from '@shared/types/league-client/summoner'
import type { SgpGameSummaryLol } from '@shared/types/sgp/match-history'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

import type { ReviewMatch } from './types'
import { useReviewData } from './use-review-data'

const fake = vi.hoisted(() => ({
  load: vi.fn(),
  scan: vi.fn(),
  read: vi.fn(),
  write: vi.fn()
}))
vi.mock('@renderer-shared/shards', () => ({
  useInstance: () => ({ api: { matchHistoryQuery: {} } })
}))
vi.mock('@renderer-shared/shards/sgp', () => ({ SgpRenderer: class {} }))
vi.mock('@renderer-shared/shards/setting-utils', () => ({ SettingUtilsRenderer: class {} }))
vi.mock('./data-loader', async (original) => ({
  ...(await original<typeof import('./data-loader')>()),
  createReviewDataLoader: () => ({ scanHistory: fake.scan, loadMatch: fake.load })
}))
vi.mock('./archive', () => ({ readReviewArchive: fake.read, writeReviewArchive: fake.write }))

function match(gameId: number, puuid = 'player-3'): ReviewMatch {
  return {
    meta: {
      gameId,
      puuid,
      sgpServerId: 'TENCENT_HN1',
      gameCreation: gameId * 1000,
      gameDuration: 1200,
      queueId: 420,
      patch: '16.18',
      championId: 238,
      position: 'MIDDLE',
      participantId: 3,
      teamId: 100,
      opponentId: 8,
      opponentChampionId: 8,
      win: true
    },
    participants: [],
    frames: [],
    events: [],
    moments: [],
    snapshots: [],
    quality: {
      expectedFrames: 21,
      missingFrames: 0,
      timelineCoverage: 1,
      validGoldSnapshots: 3,
      validCsSnapshots: 3,
      validTeamSnapshots: 3,
      eventCoverage: 'complete',
      warnings: []
    }
  }
}

function summary(gameId: number): SgpGameSummaryLol {
  return {
    json: {
      gameId,
      gameCreation: gameId * 1000,
      gameDuration: 1200,
      queueId: 420,
      mapId: 11,
      gameMode: 'CLASSIC',
      gameVersion: '16.18',
      participants: Array.from({ length: 10 }, (_, i) => ({
        participantId: i + 1,
        puuid: `player-${i + 1}`,
        teamId: i < 5 ? 100 : 200,
        teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][i % 5],
        championId: i === 2 ? 238 : i + 1,
        win: i < 5
      }))
    }
  } as SgpGameSummaryLol
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function setup(persistArchive = true) {
  const scope = effectScope()
  const puuid = ref('player-3')
  const active = ref(true)
  const server = ref('TENCENT_HN1')
  const data = scope.run(() =>
    useReviewData({ puuid, active, sgpServerId: server, persistArchive })
  )!
  return { scope, puuid, active, server, data }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  fake.read.mockResolvedValue([])
  fake.write.mockImplementation(async (_, __, matches: ReviewMatch[]) =>
    matches.map((value) => ({ match: value, savedAt: 1 }))
  )
  const sgps = useSgpStore()
  sgps.availability.sgpServerId = 'TENCENT_HN1'
  sgps.isTokenReady = true
  sgps.leagueServers = {
    updatedAt: '',
    servers: {
      TENCENT_HN1: { matchHistory: 'https://example.test/history', common: '', isTencent: true },
      EUW1: { matchHistory: 'https://example.test/history', common: '', isTencent: false }
    },
    serverNames: {}
  }
  useLeagueClientStore().summoner.me = { puuid: 'local-owner' } as SummonerInfo
})

describe('review data lifecycle', () => {
  it('archives completed games under the captured old account when an incomplete batch is cancelled', async () => {
    fake.scan.mockResolvedValue({
      summaries: [summary(2), summary(1)],
      scanned: 2,
      skipped: 0,
      truncated: false,
      failure: null
    })
    fake.load.mockImplementation(async (_, gameId: number, signal: AbortSignal) => {
      if (gameId === 1) return { ok: true, match: match(1) }
      return new Promise((_, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new DOMException('cancelled', 'AbortError')),
          { once: true }
        )
      )
    })
    const { scope, puuid, data } = setup()
    const running = data.analyze({ championId: 238 })
    await vi.waitFor(() => expect(data.matches.value).toHaveLength(1))
    puuid.value = 'player-8'
    await nextTick()
    await running
    expect(fake.write).toHaveBeenCalledTimes(1)
    expect(fake.write.mock.calls[0][1].targetPuuid).toBe('player-3')
    expect(fake.write.mock.calls[0][2].map((value: ReviewMatch) => value.meta.gameId)).toEqual([1])
    expect(data.archivedMatches.value).toEqual([])
    scope.stop()
  })

  it('keeps the secondary renderer read-only for archives', async () => {
    fake.load.mockResolvedValueOnce({ ok: true, match: match(1) })
    const { scope, data } = setup(false)
    await data.loadMatch(1)
    expect(fake.read).not.toHaveBeenCalled()
    expect(fake.write).not.toHaveBeenCalled()
    scope.stop()
  })

  it('does not let an old player response replace or archive the new player view', async () => {
    const pending = deferred<{ ok: true; match: ReviewMatch }>()
    fake.load
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce({ ok: true, match: match(2, 'player-8') })
    const { scope, puuid, data } = setup()
    const old = data.loadMatch(1)
    puuid.value = 'player-8'
    await nextTick()
    expect(fake.load.mock.calls[0][2].aborted).toBe(true)
    await data.loadMatch(2)
    pending.resolve({ ok: true, match: match(1) })
    expect(await old).toBeNull()
    expect(data.selectedMatch.value?.meta.gameId).toBe(2)
    expect(fake.write).toHaveBeenCalledTimes(1)
    expect(fake.write.mock.calls[0][1].targetPuuid).toBe('player-8')
    scope.stop()
  })

  it('cancels a hidden studio and discards its late result', async () => {
    const pending = deferred<{ ok: true; match: ReviewMatch }>()
    fake.load.mockReturnValueOnce(pending.promise)
    const { scope, active, data } = setup()
    const request = data.loadMatch(1)
    active.value = false
    await nextTick()
    expect(fake.load.mock.calls[0][2].aborted).toBe(true)
    pending.resolve({ ok: true, match: match(1) })
    expect(await request).toBeNull()
    expect(data.selectedMatch.value).toBeNull()
    expect(data.busy.value).toBe(false)
    expect(fake.write).not.toHaveBeenCalled()
    scope.stop()
  })

  it('keeps successes visible and retries only failed games', async () => {
    fake.scan.mockResolvedValue({
      summaries: [summary(2), summary(1)],
      scanned: 2,
      skipped: 0,
      truncated: false,
      failure: null
    })
    fake.load.mockImplementation(async (_, gameId: number) =>
      gameId === 1
        ? { ok: true, match: match(1) }
        : { ok: false, failure: { gameId, kind: 'network', reason: 'offline' } }
    )
    const { scope, data } = setup()
    await data.analyze({ championId: 238 }, 20)
    expect(data.matches.value.map((value) => value.meta.gameId)).toEqual([1])
    expect(data.progress.value.failed).toBe(1)
    fake.load.mockResolvedValueOnce({ ok: true, match: match(2) })
    await data.retryFailed()
    expect(fake.load.mock.calls.map((call) => call[1])).toEqual([2, 1, 2])
    expect(data.matches.value.map((value) => value.meta.gameId)).toEqual([2, 1])
    expect(data.failures.value).toEqual([])
    const corrected = match(2)
    corrected.snapshots = [
      {
        minute: 10,
        timestamp: 600_000,
        personalGoldDiff: 500,
        personalCsDiff: 12,
        teamGoldDiff: 900
      }
    ]
    fake.load.mockResolvedValueOnce({ ok: true, match: corrected })
    await data.loadMatch(2, true)
    expect(data.matches.value[0]).toEqual(corrected)
    expect(fake.load.mock.calls.at(-1)?.[4]).toBe(true)
    expect(data.matches.value).toHaveLength(2)
    scope.stop()
  })

  it('gates missing credentials and unsupported cross-region access before requests', async () => {
    const { scope, server, data } = setup()
    useSgpStore().isTokenReady = false
    await data.loadMatch(1)
    expect(data.availability.value.kind).toBe('token')
    expect(fake.load).not.toHaveBeenCalled()
    useSgpStore().isTokenReady = true
    server.value = 'EUW1'
    await nextTick()
    await data.loadMatch(1)
    expect(data.availability.value.kind).toBe('region')
    expect(fake.load).not.toHaveBeenCalled()
    scope.stop()
  })
})
