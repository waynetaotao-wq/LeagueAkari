import { describe, expect, it, vi } from 'vitest'

import { parseReviewMatch } from './analysis'
import { type ReviewArchiveScope, readReviewArchive, writeReviewArchive } from './archive'
import { planReviewAutoArchive, runReviewAutoArchive } from './auto-archive'
import { type ReviewFetchApi, ReviewMatchCache, createReviewDataLoader } from './data-loader'
import { createReviewFixture } from './test-fixtures'

const identity = { puuid: 'player-8', sgpServerId: 'TEST' }
const scope: ReviewArchiveScope = {
  ownerPuuid: 'player-8',
  ownerServerId: 'TEST',
  targetPuuid: 'player-8',
  targetServerId: 'TEST'
}

function memoryStorage() {
  const values = new Map<string, unknown>()
  return {
    get: vi.fn(async (namespace: string, key: string) => values.get(`${namespace}:${key}`) ?? null),
    set: vi.fn(async (namespace: string, key: string, value: unknown) => {
      values.set(`${namespace}:${key}`, structuredClone(value))
    })
  }
}

function setup(gameIds: number[]) {
  const games = new Map(
    gameIds.map((gameId) => {
      const fixture = createReviewFixture({ gameId })
      fixture.summary.json.gameCreation = 1_780_000_000_000 + gameId * 1000
      return [gameId, fixture]
    })
  )
  const api = {
    history: vi.fn(async (_identity: unknown, _start: number, count: number) =>
      [...games.values()]
        .map((game) => game.summary)
        .sort((a, b) => b.json.gameCreation - a.json.gameCreation)
        .slice(0, count)
    ),
    summary: vi.fn(async (_identity: unknown, gameId: number) => games.get(gameId)!.summary),
    details: vi.fn(async (_identity: unknown, gameId: number) => games.get(gameId)!.details)
  } satisfies ReviewFetchApi
  const storage = memoryStorage()
  const run = (
    options: Partial<Parameters<typeof runReviewAutoArchive>[0]> & { skipped?: Set<number> } = {}
  ) =>
    runReviewAutoArchive({
      identity,
      scope,
      api,
      storage,
      signal: new AbortController().signal,
      historyCount: 20,
      maxGames: 5,
      skipped: new Set(),
      // 每个测试用自己的缓存，避免互相借到对局。
      loader: createReviewDataLoader(api, undefined, new ReviewMatchCache()),
      ...options
    })
  const archivedIds = async () =>
    (await readReviewArchive(storage, scope)).map((record) => record.match.meta.gameId)
  return { games, api, storage, run, archivedIds }
}

describe('planReviewAutoArchive', () => {
  it('keeps eligible games that are neither archived nor skipped, newest first', () => {
    const { games } = setup([1, 2, 3, 4, 5])
    const summaries = [...games.values()].map((game) => game.summary)
    summaries[1].json.queueId = 450
    summaries.push(summaries[4])

    const planned = planReviewAutoArchive(summaries, 'player-8', new Set([3]), new Set([4]))

    expect(planned.map((summary) => summary.json.gameId)).toEqual([5, 1])
  })

  it('ignores games the player did not take part in', () => {
    const { games } = setup([1])
    expect(
      planReviewAutoArchive([games.get(1)!.summary], 'stranger', new Set(), new Set())
    ).toEqual([])
  })
})

describe('runReviewAutoArchive', () => {
  it('archives the games that are missing, with their per-game numbers', async () => {
    const { run, storage, archivedIds } = setup([1, 2, 3])

    await expect(run()).resolves.toEqual({ scanned: 3, archived: 3, failed: 0, remaining: 0 })

    expect(await archivedIds()).toEqual([3, 2, 1])
    const records = await readReviewArchive(storage, scope)
    expect(records.every((record) => record.match.digest !== null)).toBe(true)
    expect(storage.set).toHaveBeenCalledTimes(1)
  })

  it('does not read a game twice', async () => {
    const { run, api } = setup([1, 2])
    await run()
    api.details.mockClear()

    await expect(run()).resolves.toEqual({ scanned: 2, archived: 0, failed: 0, remaining: 0 })

    expect(api.details).not.toHaveBeenCalled()
  })

  it('stops at the per-run limit and continues with the next run', async () => {
    const { run, archivedIds } = setup([1, 2, 3, 4, 5])

    await expect(run({ maxGames: 2 })).resolves.toMatchObject({ archived: 2, remaining: 3 })
    expect(await archivedIds()).toEqual([5, 4])

    await expect(run({ maxGames: 2 })).resolves.toMatchObject({ archived: 2, remaining: 1 })
    expect(await archivedIds()).toEqual([5, 4, 3, 2])
  })

  it('only looks at the requested number of history entries', async () => {
    const { run, api, archivedIds } = setup([1, 2, 3, 4])

    await run({ historyCount: 2 })

    expect(api.history).toHaveBeenCalledWith(identity, 0, 2, expect.anything())
    expect(await archivedIds()).toEqual([4, 3])
  })

  it('reads a game again when its old record has no per-game numbers', async () => {
    const { games, run, storage } = setup([1, 2])
    const fixture = games.get(1)!
    const parsed = parseReviewMatch(fixture.summary, fixture.details, 'player-8', 'TEST')
    if (!parsed.ok) throw new Error('fixture did not parse')
    await writeReviewArchive(storage, scope, [{ ...parsed.match, digest: null }])
    expect((await readReviewArchive(storage, scope))[0].match.digest).toBeNull()

    await expect(run()).resolves.toMatchObject({ archived: 2 })

    const records = await readReviewArchive(storage, scope)
    expect(records.map((record) => record.match.digest !== null)).toEqual([true, true])
  })

  it('remembers a game the server cannot provide and moves on', async () => {
    const { run, api, archivedIds } = setup([1, 2, 3])
    api.details.mockImplementation(async (_identity: unknown, gameId: number) => {
      if (gameId === 2) throw Object.assign(new Error('gone'), { response: { status: 404 } })
      return setup([gameId]).games.get(gameId)!.details
    })
    const skipped = new Set<number>()

    await expect(run({ skipped })).resolves.toEqual({
      scanned: 3,
      archived: 2,
      failed: 1,
      remaining: 0
    })

    expect([...skipped]).toEqual([2])
    expect(await archivedIds()).toEqual([3, 1])
    api.details.mockClear()
    await run({ skipped })
    expect(api.details).not.toHaveBeenCalled()
  })

  it('stops on a network failure, keeps what it has and tries the game again later', async () => {
    const { run, api, archivedIds } = setup([1, 2, 3])
    api.details.mockImplementationOnce(
      async (_identity: unknown, gameId: number) => setup([gameId]).games.get(gameId)!.details
    )
    api.details.mockImplementationOnce(async () => {
      throw new Error('network down')
    })
    const skipped = new Set<number>()

    await expect(run({ skipped })).resolves.toEqual({
      scanned: 3,
      archived: 1,
      failed: 1,
      remaining: 1
    })

    expect(skipped.size).toBe(0)
    expect(await archivedIds()).toEqual([3])
    await expect(run({ skipped })).resolves.toMatchObject({ archived: 2, failed: 0 })
    expect(await archivedIds()).toEqual([3, 2, 1])
  })

  it('fails without touching the archive when history cannot be read', async () => {
    const { run, api, storage } = setup([1])
    api.history.mockRejectedValueOnce(new Error('history down'))

    await expect(run()).rejects.toThrow('history down')

    expect(storage.set).not.toHaveBeenCalled()
  })

  it('keeps the games already read when it is cancelled halfway', async () => {
    const { run, api, archivedIds } = setup([1, 2, 3])
    const controller = new AbortController()
    const original = api.details.getMockImplementation()!
    api.details.mockImplementation(async (target: unknown, gameId: number) => {
      const result = await original(target, gameId)
      if (gameId === 2) controller.abort()
      return result
    })

    await expect(run({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })

    expect(await archivedIds()).toEqual([3])
  })

  it('does nothing when it is cancelled before it starts', async () => {
    const { run, api } = setup([1])
    const controller = new AbortController()
    controller.abort()

    await expect(run({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })

    expect(api.history).not.toHaveBeenCalled()
  })
})
