import type {
  DetailedParticipantFrame,
  SgpGameDetailsLol,
  SgpGameSummaryLol
} from '@shared/types/sgp/match-history'
import { describe, expect, it, vi } from 'vitest'

import {
  type ReviewFetchApi,
  ReviewMatchCache,
  ReviewRequestPool,
  createReviewDataLoader,
  getReviewCandidate,
  matchesReviewCandidate
} from './data-loader'

const identity = { puuid: 'player-3', sgpServerId: 'TENCENT_HN1' }
const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

function summary(gameId = 1, championId = 238): SgpGameSummaryLol {
  return {
    metadata: { match_id: `HN1_${gameId}` },
    json: {
      gameId,
      gameMode: 'CLASSIC',
      mapId: 11,
      queueId: 420,
      gameDuration: 1200,
      gameCreation: gameId * 1000,
      gameVersion: '16.18.1',
      endOfGameResult: 'GameComplete',
      participants: Array.from({ length: 10 }, (_, index) => ({
        participantId: index + 1,
        puuid: `player-${index + 1}`,
        teamId: index < 5 ? 100 : 200,
        teamPosition: positions[index % 5],
        individualPosition: positions[index % 5],
        championId: index === 2 ? championId : 1 + index,
        championName: `Champion${index}`,
        deaths: 0,
        win: index < 5,
        gameEndedInEarlySurrender: false
      }))
    }
  } as SgpGameSummaryLol
}

function details(gameId = 1): SgpGameDetailsLol {
  return {
    metadata: {
      match_id: `HN1_${gameId}`,
      product: 'lol',
      tags: [],
      participants: summary(gameId).json.participants.map((participant) => participant.puuid),
      timestamp: '2026-09-04T00:00:00Z',
      data_version: '2',
      info_type: 'DETAILS',
      private: false
    },
    json: {
      gameId,
      endOfGameResult: 'GameComplete',
      frameInterval: 60_000,
      participants: summary(gameId).json.participants.map(({ participantId, puuid }) => ({
        participantId,
        puuid
      })),
      frames: Array.from({ length: 21 }, (_, minute) => ({
        timestamp: minute * 60_000,
        events: [],
        participantFrames: Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [
            String(index + 1),
            {
              participantId: index + 1,
              totalGold: 500 + minute * 300,
              minionsKilled: minute * 5,
              jungleMinionsKilled: 0,
              level: Math.max(1, Math.floor(minute / 2)),
              position: { x: 7000, y: 7000 },
              championStats: { health: 500 }
            } as DetailedParticipantFrame
          ])
        )
      }))
    }
  }
}

function api(): ReviewFetchApi {
  return {
    history: vi.fn(async () => [summary()]),
    summary: vi.fn(async (_, gameId) => summary(gameId)),
    details: vi.fn(async (_, gameId) => details(gameId))
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('review data loading', () => {
  it('limits all callers to three active requests and removes cancelled queued work', async () => {
    const pool = new ReviewRequestPool(3)
    const gates = [deferred<number>(), deferred<number>(), deferred<number>()]
    const controllers = Array.from({ length: 4 }, () => new AbortController())
    const invoked = vi.fn()
    const requests = gates.map((gate, index) =>
      pool.run(controllers[index].signal, () => {
        invoked()
        return gate.promise
      })
    )
    const queued = pool.run(controllers[3].signal, async () => {
      invoked()
      return 99
    })
    const rejection = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    expect(invoked).toHaveBeenCalledTimes(3)
    controllers[3].abort()
    gates.forEach((gate, index) => gate.resolve(index))
    expect(await Promise.all(requests)).toEqual([0, 1, 2])
    await rejection
    expect(invoked).toHaveBeenCalledTimes(3)
    expect(await pool.run(new AbortController().signal, async () => 4)).toBe(4)
  })

  it('caps the scan at 500 summaries, deduplicates pages and excludes ineligible games', async () => {
    const source = api()
    source.history = vi.fn(async (_, start) =>
      Array.from({ length: 100 }, (_, index) => {
        const value = summary(start === 100 ? index + 1 : start + index + 1)
        if (value.json.gameId === 1) value.json.mapId = 12
        return value
      })
    )
    const loader = createReviewDataLoader(source, new ReviewRequestPool(), new ReviewMatchCache())
    const result = await loader.scanHistory(identity, new AbortController().signal)
    expect(source.history).toHaveBeenCalledTimes(5)
    expect(result.scanned).toBe(500)
    expect(result.skipped).toBe(1)
    expect(result.summaries).toHaveLength(399)
    expect(result.truncated).toBe(true)
    expect(source.details).not.toHaveBeenCalled()
  })

  it('preserves usable pages and distinguishes a network failure from an empty history', async () => {
    const source = api()
    source.history = vi.fn(async (_, start) => {
      if (start) throw new Error('offline')
      return Array.from({ length: 100 }, (_, index) => summary(index + 1))
    })
    const loader = createReviewDataLoader(source, new ReviewRequestPool(), new ReviewMatchCache())
    const progress = vi.fn()
    const result = await loader.scanHistory(identity, new AbortController().signal, progress)
    expect(result.summaries).toHaveLength(100)
    expect(result.failure?.kind).toBe('network')
    expect(result.truncated).toBe(true)
    expect(progress).toHaveBeenCalledWith(100, 0, expect.any(Array))
  })

  it('never requests details for an unsupported game and detects mismatched timeline IDs', async () => {
    const source = api()
    const loader = createReviewDataLoader(source, new ReviewRequestPool(), new ReviewMatchCache())
    const unsupported = summary()
    unsupported.json.queueId = 450
    expect(
      await loader.loadMatch(identity, 1, new AbortController().signal, unsupported)
    ).toMatchObject({ ok: false, failure: { kind: 'invalid' } })
    expect(source.details).not.toHaveBeenCalled()
    source.details = vi.fn(async () => details(2))
    const mismatchLoader = createReviewDataLoader(
      source,
      new ReviewRequestPool(),
      new ReviewMatchCache()
    )
    expect(await mismatchLoader.loadMatch(identity, 1, new AbortController().signal)).toMatchObject(
      { ok: false, failure: { kind: 'invalid' } }
    )
  })

  it('reuses successful timelines but retries failures and isolates server/player identity', async () => {
    const source = api()
    const getDetails = vi
      .fn()
      .mockRejectedValueOnce({ response: { status: 404 } })
      .mockImplementation(async (_, gameId) => details(gameId))
    source.details = getDetails
    const loader = createReviewDataLoader(source, new ReviewRequestPool(), new ReviewMatchCache())
    const signal = new AbortController().signal
    expect(await loader.loadMatch(identity, 1, signal)).toMatchObject({
      ok: false,
      failure: { kind: 'unavailable' }
    })
    const loaded = await loader.loadMatch(identity, 1, signal)
    expect(loaded.ok).toBe(true)
    expect(await loader.loadMatch(identity, 1, signal)).toEqual(
      loaded.ok ? expect.objectContaining({ match: loaded.match }) : undefined
    )
    expect(getDetails).toHaveBeenCalledTimes(2)
    await loader.loadMatch({ ...identity, sgpServerId: 'TENCENT_HN2' }, 1, signal)
    await loader.loadMatch({ ...identity, puuid: 'player-8' }, 1, signal)
    expect(getDetails).toHaveBeenCalledTimes(4)
  })

  it('expires and bounds successful cache entries', async () => {
    let now = 0
    const source = api()
    const loader = createReviewDataLoader(
      source,
      new ReviewRequestPool(),
      new ReviewMatchCache(1, 100, () => now)
    )
    const signal = new AbortController().signal
    await loader.loadMatch(identity, 1, signal)
    await loader.loadMatch(identity, 2, signal)
    await loader.loadMatch(identity, 1, signal)
    expect(source.details).toHaveBeenCalledTimes(3)
    now = 101
    await loader.loadMatch(identity, 1, signal)
    expect(source.details).toHaveBeenCalledTimes(4)
    await loader.loadMatch(identity, 1, signal, undefined, true)
    expect(source.details).toHaveBeenCalledTimes(5)
  })

  it('does not cache an incomplete timeline as a final successful response', async () => {
    const source = api()
    source.details = vi.fn(async () => {
      const partial = details()
      partial.json.frames = partial.json.frames.slice(0, 11)
      return partial
    })
    const loader = createReviewDataLoader(source, new ReviewRequestPool(), new ReviewMatchCache())
    const signal = new AbortController().signal
    const result = await loader.loadMatch(identity, 1, signal)
    expect(result.ok).toBe(true)
    await loader.loadMatch(identity, 1, signal)
    expect(source.details).toHaveBeenCalledTimes(2)
  })

  it('discards a late response after cancellation rather than caching it as success', async () => {
    const source = api()
    const delayed = deferred<SgpGameDetailsLol>()
    source.details = vi
      .fn()
      .mockImplementationOnce(() => delayed.promise)
      .mockResolvedValue(details())
    const loader = createReviewDataLoader(source, new ReviewRequestPool(), new ReviewMatchCache())
    const controller = new AbortController()
    const request = loader.loadMatch(identity, 1, controller.signal, summary())
    const rejection = expect(request).rejects.toMatchObject({ name: 'AbortError' })
    await Promise.resolve()
    await Promise.resolve()
    controller.abort()
    delayed.resolve(details())
    await rejection
    expect((await loader.loadMatch(identity, 1, new AbortController().signal, summary())).ok).toBe(
      true
    )
    expect(source.details).toHaveBeenCalledTimes(2)
  })

  it('filters candidate metadata consistently and does not invent an ambiguous lane opponent', () => {
    const game = summary()
    const candidate = getReviewCandidate(game, identity.puuid)!
    expect(
      matchesReviewCandidate(candidate, {
        championId: 238,
        position: 'MIDDLE',
        patch: '16.18',
        queueId: 420,
        opponentChampionId: 8
      })
    ).toBe(true)
    expect(matchesReviewCandidate(candidate, { position: 'TOP' })).toBe(false)
    game.json.participants[0].teamPosition = 'MIDDLE'
    expect(getReviewCandidate(game, identity.puuid)?.opponentChampionId).toBeNull()
  })
})
