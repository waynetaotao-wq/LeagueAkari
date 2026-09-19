import type {
  ChampionDataDetails,
  ChampionDataLoadResult
} from '@shared/data-adapter/champion-data'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DraftMatchupLoader, readMatchupSamples } from './matchup-loader'

function success<T>(data: T): ChampionDataLoadResult<T> {
  return {
    status: 'success',
    data,
    preferredSource: 'opgg',
    effectiveSource: 'opgg',
    fallbackReason: null,
    attempts: []
  }
}

function details(championId = 13): ChampionDataDetails {
  return {
    metadata: { source: 'opgg', mode: 'ranked', patch: '16.18' },
    championId,
    summary: { championId, position: 'middle' },
    sections: {
      positions: [{ position: 'middle' }],
      matchups: [{ championId: 105, performance: { games: 1000, wins: 530, winRate: 0.53 } }]
    }
  } as ChampionDataDetails
}

afterEach(() => vi.useRealTimers())

describe('Flex draft matchup source contract', () => {
  it('keeps the queried champion perspective and rejects mismatched patch, position or source', () => {
    expect(readMatchupSamples(details(), 13, 'middle', '16.18')).toEqual([
      { championId: 105, games: 1000, wins: 530 }
    ])
    expect(readMatchupSamples(details(), 13, 'middle', '16.17')).toBeNull()
    expect(readMatchupSamples(details(), 13, 'top', '16.18')).toBeNull()
    expect(readMatchupSamples(details(), 103, 'middle', '16.18')).toBeNull()
    const missingRole = details()
    missingRole.sections.positions = []
    expect(readMatchupSamples(missingRole, 13, 'middle', '16.18')).toBeNull()
    const wrongSource = details()
    wrongSource.metadata.source = 'qq101'
    expect(readMatchupSamples(wrongSource, 13, 'middle', '16.18')).toBeNull()
  })

  it('rejects invalid and duplicate matchup records without inventing rates', () => {
    const data = details()
    data.sections.matchups!.push(
      data.sections.matchups![0],
      { championId: 7, relationship: 'unknown', performance: { games: 100, wins: 120 } as never },
      { championId: 238, relationship: 'unknown', performance: { games: 100, wins: null } as never }
    )
    expect(readMatchupSamples(data, 13, 'middle', '16.18')).toEqual([])
  })

  it('uses one current patch, bounds concurrency and reuses only successful cached samples', async () => {
    let active = 0
    let maxActive = 0
    const source = {
      loadPatches: vi.fn(async () => success(['16.18'])),
      loadDetails: vi.fn(async (_query, id: number) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active--
        if (id === 238) throw new Error('offline')
        return success(details(id))
      })
    }
    const loader = new DraftMatchupLoader(source)
    const signal = new AbortController().signal
    expect(await loader.load('middle', [13, 103, 238], signal)).toMatchObject({
      patch: '16.18',
      failed: [238]
    })
    await loader.load('middle', [13, 103, 238], signal)
    expect(maxActive).toBe(2)
    expect(source.loadPatches).toHaveBeenCalledTimes(1)
    expect(source.loadDetails).toHaveBeenCalledTimes(4)
    expect(
      source.loadDetails.mock.calls.every(
        ([q]) => q.patch === '16.18' && q.source === 'opgg' && q.region === 'kr'
      )
    ).toBe(true)
    loader.clear()
    await loader.load('middle', [13], signal)
    expect(source.loadPatches).toHaveBeenCalledTimes(2)
  })

  it('discards a response arriving after cancellation instead of caching it for the next draft', async () => {
    let complete!: (data: ChampionDataLoadResult<ChampionDataDetails>) => void
    const source = {
      loadPatches: vi.fn(async () => success(['16.18'])),
      loadDetails: vi.fn(
        () =>
          new Promise<ChampionDataLoadResult<ChampionDataDetails>>((resolve) => {
            complete = resolve
          })
      )
    }
    const loader = new DraftMatchupLoader(source)
    const controller = new AbortController()
    const request = loader.load('middle', [13], controller.signal)
    const rejected = expect(request).rejects.toThrow()
    await vi.waitFor(() => expect(source.loadDetails).toHaveBeenCalledOnce())
    controller.abort()
    complete(success(details()))
    await rejected
    source.loadDetails.mockImplementation(async () => success(details()))
    const next = await loader.load('middle', [13], new AbortController().signal)
    expect(next.samples[13]).toHaveLength(1)
    expect(source.loadDetails).toHaveBeenCalledTimes(2)
  })

  it('returns completed results at the deadline even when another IPC call ignores cancellation', async () => {
    vi.useFakeTimers()
    let finish!: (data: ChampionDataLoadResult<ChampionDataDetails>) => void
    const source = {
      loadPatches: vi.fn(async () => success(['16.18'])),
      loadDetails: vi.fn(async (_query, id: number) =>
        id === 13
          ? success(details(id))
          : new Promise<ChampionDataLoadResult<ChampionDataDetails>>(
              (resolve) => (finish = resolve)
            )
      )
    }
    const loader = new DraftMatchupLoader(source)
    const request = loader.load('middle', [13, 103], new AbortController().signal)
    await vi.advanceTimersByTimeAsync(30_001)
    expect(await request).toMatchObject({
      patch: '16.18',
      samples: { 13: [{ championId: 105 }] },
      failed: [103]
    })
    finish(success(details(103)))
    source.loadDetails.mockImplementation(async (_query, id) => success(details(id)))
    const retry = await loader.load('middle', [13, 103], new AbortController().signal)
    expect(retry.failed).toEqual([])
    expect(source.loadDetails).toHaveBeenCalledTimes(3)
  })

  it('never mixes cached previous-patch statistics into a partially available new patch', async () => {
    vi.useFakeTimers()
    const source = {
      loadPatches: vi.fn(async () => success(['16.18'])),
      loadDetails: vi.fn(async (_query, id: number) => success(details(id)))
    }
    const loader = new DraftMatchupLoader(source)
    const signal = new AbortController().signal
    await loader.load('middle', [13, 103], signal)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    source.loadPatches.mockResolvedValue(success(['16.19']))
    source.loadDetails.mockImplementation(async (_query, id) => {
      const data = details(id)
      if (id === 13) data.metadata.patch = '16.19'
      return success(data)
    })
    const progress = vi.fn()
    const next = await loader.load('middle', [13, 103], signal, progress)
    expect(next.patch).toBe('16.19')
    expect(next.failed).toEqual([103])
    expect(next.samples[103]).toBeUndefined()
    expect(progress.mock.calls.every(([r]) => r.patch === '16.19' && !r.samples[103])).toBe(true)
    expect(source.loadPatches).toHaveBeenCalledTimes(2)
  })
})
