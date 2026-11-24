import type {
  ChampionDataDetails,
  ChampionDataLoadResult,
  ChampionDataQuery
} from '@shared/data-adapter/champion-data'
import type { MatchupBuildParams, MatchupBuildResult } from '@shared/types/counter-intel'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  REVIEW_STATISTICS_CACHE_SIZE,
  ReviewStatisticsLoader,
  type ReviewStatisticsRequest
} from './coach-statistics-loader'

const success = <T>(data: T): ChampionDataLoadResult<T> => ({
  status: 'success',
  data,
  preferredSource: 'opgg',
  effectiveSource: 'opgg',
  fallbackReason: null,
  attempts: []
})
const unavailable = <T>(): ChampionDataLoadResult<T> => ({
  status: 'unavailable',
  data: null,
  preferredSource: 'opgg',
  effectiveSource: null,
  fallbackReason: 'request-failed',
  attempts: []
})

const performance = (games: number, wins: number, pickRate: number | null = null) => ({
  games,
  wins,
  winRate: wins / games,
  pickRate,
  rank: null,
  averagePlacement: null,
  firstPlaceRate: null
})

function details(patch: string, championId = 238): ChampionDataDetails {
  return {
    metadata: { source: 'opgg', mode: 'ranked', patch, dataDate: null, updatedAt: null },
    championId,
    summary: {
      championId,
      position: 'middle',
      performance: {
        games: 12_000,
        wins: null,
        winRate: 0.501,
        pickRate: 0.042,
        banRate: null,
        kda: null,
        rank: null,
        rankChange: null,
        strengthTier: null,
        averagePlacement: null,
        firstPlaceRate: null
      },
      counterChampionIds: []
    },
    sections: {
      matchups: [{ championId: 103, relationship: 'unknown', performance: performance(400, 188) }],
      summonerSpells: [{ spellIds: [4, 14], performance: performance(9000, 4545, 0.75) }]
    }
  }
}

function matchup(sourceVersion: string | null, verified = true): MatchupBuildResult {
  return {
    myChampionId: 238,
    opponentChampionId: 103,
    position: 'middle',
    region: 'kr',
    tier: 'emerald_plus',
    version: sourceVersion,
    sourceVersion,
    meta: { play: 400, win: 188 },
    overlay: verified
      ? { summoner_spells: [{ ids: [4, 12], play: 120, win: 66, pick_rate: 0.3 }] }
      : null,
    parsedSections: [],
    targetVerified: verified,
    updatedAt: ''
  }
}

const request: ReviewStatisticsRequest = {
  championId: 238,
  opponentChampionId: 103,
  position: 'MIDDLE',
  patch: '16.22',
  region: 'kr',
  tier: 'emerald_plus'
}

function sources(overrides: Partial<Parameters<typeof build>[0]> = {}) {
  return build({ patches: ['16.23', '16.22'], ...overrides })
}
function build(options: {
  patches: string[] | null
  details?: (query: ChampionDataQuery, championId: number) => ChampionDataDetails | null
  matchup?: (params: MatchupBuildParams) => Promise<MatchupBuildResult>
}) {
  const loadPatches = vi.fn(async (_query: ChampionDataQuery) =>
    options.patches ? success(options.patches) : unavailable<string[]>()
  )
  const loadDetails = vi.fn(async (query: ChampionDataQuery, championId: number) => {
    const data = options.details
      ? options.details(query, championId)
      : details(query.patch!, championId)
    return data ? success(data) : unavailable<ChampionDataDetails>()
  })
  const loadMatchup = vi.fn(
    options.matchup ?? (async (params: MatchupBuildParams) => matchup(params.version))
  )
  return { loadPatches, loadDetails, loadMatchup }
}

afterEach(() => vi.useRealTimers())

describe('ReviewStatisticsLoader', () => {
  it('asks for the game’s own patch, the general tables and the matchup tables', async () => {
    const source = sources()
    const statistics = await new ReviewStatisticsLoader(source).load(request)

    expect(source.loadPatches).toHaveBeenCalledWith(
      { source: 'opgg', mode: 'ranked', region: 'kr', tier: 'emerald_plus' },
      expect.anything()
    )
    expect(source.loadDetails).toHaveBeenCalledWith(
      {
        source: 'opgg',
        mode: 'ranked',
        region: 'kr',
        tier: 'emerald_plus',
        patch: '16.22',
        position: 'middle'
      },
      238,
      expect.anything()
    )
    expect(source.loadMatchup).toHaveBeenCalledWith({
      myChampionId: 238,
      opponentChampionId: 103,
      position: 'middle',
      region: 'kr',
      tier: 'emerald_plus',
      version: '16.22'
    })
    expect(statistics).toMatchObject({
      region: 'kr',
      tier: 'emerald_plus',
      patch: '16.22',
      samePatch: true,
      champion: { games: 12_000, winRate: 0.501 },
      matchup: { games: 400, wins: 188 },
      general: { spells: [{ ids: [4, 14], games: 9000 }] },
      versus: { spells: [{ ids: [4, 12], games: 120 }] }
    })
  })

  it('uses the newest patch for an old game and says so', async () => {
    const source = sources()
    const statistics = await new ReviewStatisticsLoader(source).load({ ...request, patch: '16.15' })

    expect(source.loadDetails.mock.calls[0][0].patch).toBe('16.23')
    expect(statistics).toMatchObject({ patch: '16.23', samePatch: false })
  })

  it('goes by the patch the source answered with, not the one that was asked for', async () => {
    const source = sources({ details: () => details('16.23') })
    const statistics = await new ReviewStatisticsLoader(source).load(request)

    // Asked for 16.22, answered with 16.23: not this game's patch, and the matchup tables,
    // which were answered for 16.22, are not mixed in.
    expect(statistics).toMatchObject({ patch: '16.23', samePatch: false, versus: null })
  })

  it('does not ask for a matchup without a lane opponent', async () => {
    const source = sources()
    const statistics = await new ReviewStatisticsLoader(source).load({
      ...request,
      opponentChampionId: null
    })

    expect(source.loadMatchup).not.toHaveBeenCalled()
    expect(statistics).toMatchObject({ matchup: null, versus: null })
  })

  it('keeps the general tables when the matchup tables fail or are not verified', async () => {
    const failing = sources({ matchup: async () => Promise.reject(new Error('offline')) })
    expect(await new ReviewStatisticsLoader(failing).load(request)).toMatchObject({
      patch: '16.22',
      versus: null,
      general: { spells: [{ ids: [4, 14] }] }
    })

    const unverified = sources({ matchup: async (params) => matchup(params.version, false) })
    expect((await new ReviewStatisticsLoader(unverified).load(request))!.versus).toBeNull()
  })

  it.each([
    ['the source lists no patch', sources({ patches: [] })],
    ['the patch list cannot be had', sources({ patches: null })],
    ['the champion has no data', sources({ details: () => null })],
    [
      'the answer is about another champion',
      sources({ details: (query) => details(query.patch!, 103) })
    ]
  ])('has no statistics when %s', async (_, source) => {
    expect(await new ReviewStatisticsLoader(source).load(request)).toBeNull()
  })

  it('has no statistics for a role the source does not know', async () => {
    const source = sources()
    expect(
      await new ReviewStatisticsLoader(source).load({ ...request, position: 'UNKNOWN' })
    ).toBeNull()
    expect(source.loadPatches).not.toHaveBeenCalled()
  })

  it('never rejects, whatever the source throws', async () => {
    const source = sources()
    source.loadPatches.mockRejectedValueOnce(new Error('boom'))
    expect(await new ReviewStatisticsLoader(source).load(request)).toBeNull()
  })

  it('remembers an answer and does not remember a failure', async () => {
    const source = sources()
    const loader = new ReviewStatisticsLoader(source)
    expect(loader.peek(request)).toBeUndefined()

    source.loadPatches.mockRejectedValueOnce(new Error('offline'))
    expect(await loader.load(request)).toBeNull()
    expect(loader.peek(request)).toBeUndefined()

    const first = await loader.load(request)
    expect(loader.peek(request)).toBe(first)
    expect(await loader.load(request)).toBe(first)
    // One failed try, one that worked; the third came from memory.
    expect(source.loadPatches).toHaveBeenCalledTimes(2)
    // Another region is another question.
    await loader.load({ ...request, region: 'na' })
    expect(source.loadPatches).toHaveBeenCalledTimes(3)
  })

  it('forgets the oldest answers once it holds too many', async () => {
    const loader = new ReviewStatisticsLoader(sources())
    for (let championId = 1; championId <= REVIEW_STATISTICS_CACHE_SIZE + 1; championId++)
      await loader.load({ ...request, championId, opponentChampionId: null })

    expect(loader.peek({ ...request, championId: 1, opponentChampionId: null })).toBeUndefined()
    expect(loader.peek({ ...request, championId: 2, opponentChampionId: null })).toBeDefined()
  })

  it('stops waiting when the source takes too long', async () => {
    vi.useFakeTimers()
    const source = sources()
    source.loadPatches.mockImplementation(() => new Promise(() => {}))
    const pending = new ReviewStatisticsLoader(source, 5000).load(request)

    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toBeNull()
  })

  it('stops waiting when the request is called off, and keeps nothing', async () => {
    const source = sources()
    let finish: (value: ChampionDataLoadResult<string[]>) => void = () => {}
    source.loadPatches.mockImplementation(() => new Promise((resolve) => (finish = resolve)))
    const loader = new ReviewStatisticsLoader(source)
    const abort = new AbortController()
    const pending = loader.load(request, abort.signal)

    abort.abort()
    expect(await pending).toBeNull()
    // A late answer to the abandoned request is not remembered.
    finish(success(['16.22']))
    await Promise.resolve()
    expect(loader.peek(request)).toBeUndefined()
  })
})
