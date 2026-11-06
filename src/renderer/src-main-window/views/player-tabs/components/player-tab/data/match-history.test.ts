import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { LoggerRenderer } from '@renderer-shared/shards/logger'
import type { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { SavedSettingWatcher } from '@renderer-shared/shards/setting-utils/saved-setting-watcher'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import lcuGameFixture from '@shared/test-fixtures/api/snapshots/2026-05-16-tencent-hn10/lcu/match-history/games/q_420.json'
import lcuTimelineFixture from '@shared/test-fixtures/api/snapshots/2026-05-16-tencent-hn10/lcu/match-history/timelines/q_420.json'
import sgpHistoryFixture from '@shared/test-fixtures/api/snapshots/2026-05-16-tencent-hn10/sgp/match-history-query/q_420.json'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, nextTick, ref } from 'vue'

import type { MatchHistoryInitParams } from '@main-window/shards/player-tabs/context'
import { syncPlayerTabsSettings } from '@main-window/shards/player-tabs/settings-sync'
import { usePlayerTabsStore } from '@main-window/shards/player-tabs/store'

import { createEmptyState } from '../widgets/match-history-filters/filter-state'
import { type MatchHistoryContext, provideMatchHistory } from './match-history'

const mocks = vi.hoisted(() => ({
  useInstance: vi.fn(),
  getSgpMatchHistory: vi.fn(),
  getLcuMatchHistory: vi.fn(),
  getLcuGame: vi.fn(),
  getLcuTimeline: vi.fn(),
  getReplayConfiguration: vi.fn(),
  logWarn: vi.fn(),
  notificationError: vi.fn()
}))

vi.mock('@renderer-shared/shards', () => ({ useInstance: mocks.useInstance }))
vi.mock('@renderer-shared/shards/league-client', () => ({
  LeagueClientRenderer: class {}
}))
vi.mock('@renderer-shared/shards/sgp', () => ({ SgpRenderer: class {} }))
vi.mock('@renderer-shared/shards/logger', () => ({ LoggerRenderer: class {} }))
vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({
  useNotification: () => ({ error: mocks.notificationError }),
  useMessage: () => ({ error: vi.fn(), success: vi.fn() })
}))

// Mount the data provider without a DOM; the API boundary is the observable result.
const renderer = createRenderer<object, object>({
  patchProp: () => {},
  insert: () => {},
  remove: () => {},
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText: () => {},
  setElementText: () => {},
  parentNode: () => null,
  nextSibling: () => null
})

const cleanups: (() => void)[] = []

function mountMatchHistory(
  options: {
    ready?: boolean
    source?: 'lcu' | 'sgp'
    initParams?: MatchHistoryInitParams
  } = {}
) {
  const status = ref({ canUse: true, isReady: options.ready ?? true })
  const source = ref(options.source ?? 'sgp')
  const puuid = ref('player-1')
  const serverId = ref('HN10')
  let context!: MatchHistoryContext
  const app = renderer.createApp({
    setup() {
      context = provideMatchHistory(
        {
          puuid,
          preferredSource: source,
          sgpServerId: serverId,
          isCrossRegion: false,
          sgpApiStatus: status,
          filterState: createEmptyState(),
          syncCollectFilterState: vi.fn()
        },
        {
          pendingInitParams: ref({}),
          consumeMatchHistoryInitParams: () => options.initParams ?? null,
          onMatchHistoryInitParamsUpdate: () => {}
        }
      )
      return () => null
    }
  })
  app.mount({})
  let mounted = true
  const unmount = () => {
    if (mounted) app.unmount()
    mounted = false
  }
  cleanups.push(unmount)
  return { context, status, source, puuid, serverId, unmount }
}

async function waitForLoad(context: MatchHistoryContext) {
  await vi.waitFor(() => {
    expect(context.page.value).not.toBeNull()
    expect(context.isLoading.value).toBe(false)
  })
}

describe('match history loading', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.resetAllMocks()
    mocks.getSgpMatchHistory.mockResolvedValue({ data: { games: [] } })
    mocks.getLcuMatchHistory.mockResolvedValue({ data: { games: { games: [] } } })
    mocks.getLcuGame.mockImplementation(async (gameId: number) => ({
      data: { ...lcuGameFixture, gameId }
    }))
    mocks.getLcuTimeline.mockResolvedValue({ data: lcuTimelineFixture })
    mocks.getReplayConfiguration.mockResolvedValue({ data: { isReplaysEnabled: false } })
    const instances = new Map<unknown, unknown>([
      [
        SgpRenderer,
        {
          api: {
            matchHistoryQuery: { getMatchHistorySummaryByPlayerPuuid: mocks.getSgpMatchHistory }
          }
        }
      ],
      [
        LeagueClientRenderer,
        {
          api: {
            matchHistory: {
              getMatchHistory: mocks.getLcuMatchHistory,
              getGame: mocks.getLcuGame,
              getTimeline: mocks.getLcuTimeline
            },
            replays: { getConfiguration: mocks.getReplayConfiguration }
          },
          onLcuEventVue: () => {}
        }
      ],
      [LoggerRenderer, { info: vi.fn(), warn: mocks.logWarn, error: vi.fn() }]
    ])
    mocks.useInstance.mockImplementation((shard) => instances.get(shard))
  })

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup()
    expect(mocks.notificationError).not.toHaveBeenCalled()
  })

  it('loads the saved mode after recreating the renderer store', async () => {
    const saved = new Map<string, unknown>()
    let watcher: SavedSettingWatcher
    const settings = {
      get: async (namespace: string, key: string, fallback: unknown) =>
        saved.get(`${namespace}/${key}`) ?? fallback,
      set: async (namespace: string, key: string, value: unknown) => {
        saved.set(`${namespace}/${key}`, value)
      },
      savedPropVue: (...args: Parameters<SavedSettingWatcher['savedPropVue']>) =>
        watcher.savedPropVue(...args)
    } as unknown as SettingUtilsRenderer
    watcher = new SavedSettingWatcher(settings)
    cleanups.push(() => watcher.dispose())
    await syncPlayerTabsSettings(settings)
    usePlayerTabsStore().frontendSettings.defaultMatchHistoryTag = 'q_420'
    await nextTick()
    watcher.dispose()

    setActivePinia(createPinia())
    await syncPlayerTabsSettings(settings)
    const { context } = mountMatchHistory()
    await waitForLoad(context)

    expect(mocks.getSgpMatchHistory).toHaveBeenCalledWith('player-1', {
      tag: 'q_420',
      startIndex: 0,
      count: 20,
      __sgpServerId: 'HN10',
      signal: expect.any(AbortSignal)
    })
    expect(context.page.value?.queryParams.tag).toBe('q_420')
  })

  it('keeps all modes unfiltered for a new installation', async () => {
    const { context } = mountMatchHistory()
    await waitForLoad(context)

    expect(mocks.getSgpMatchHistory.mock.calls[0][1].tag).toBeUndefined()
  })

  it('keeps each page mode through pagination, explicit clearing, and new tabs', async () => {
    const store = usePlayerTabsStore()
    store.frontendSettings.defaultMatchHistoryTag = 'q_420'
    const { context } = mountMatchHistory()
    await waitForLoad(context)

    // Another tab changes the shared preference; this tab retains its own mode.
    store.frontendSettings.defaultMatchHistoryTag = 'q_450'
    await context.loadMatchHistory({ startIndex: 20 })
    expect(mocks.getSgpMatchHistory.mock.lastCall?.[1]).toMatchObject({
      tag: 'q_420',
      startIndex: 20
    })

    const nextTab = mountMatchHistory()
    await waitForLoad(nextTab.context)
    expect(nextTab.context.page.value?.queryParams.tag).toBe('q_450')

    store.frontendSettings.defaultMatchHistoryTag = '<akari:all>'
    await context.loadMatchHistory({ tag: undefined, startIndex: 0 })
    await context.loadMatchHistory({ startIndex: 20 })
    expect(mocks.getSgpMatchHistory.mock.lastCall?.[1].tag).toBeUndefined()
    const allModesTab = mountMatchHistory()
    await waitForLoad(allModesTab.context)
    expect(allModesTab.context.page.value?.queryParams.tag).toBeUndefined()
  })

  it('restores the mode when SGP tokens become ready', async () => {
    usePlayerTabsStore().frontendSettings.defaultMatchHistoryTag = 'q_420'
    const { context, status } = mountMatchHistory({ ready: false })
    expect(mocks.getSgpMatchHistory).not.toHaveBeenCalled()

    status.value.isReady = true
    await waitForLoad(context)
    expect(context.page.value?.queryParams.tag).toBe('q_420')
  })

  it('does not apply an SGP mode to LCU history', async () => {
    usePlayerTabsStore().frontendSettings.defaultMatchHistoryTag = 'q_420'
    const { context } = mountMatchHistory({ source: 'lcu' })
    await waitForLoad(context)

    expect(mocks.getSgpMatchHistory).not.toHaveBeenCalled()
    expect(mocks.getLcuMatchHistory).toHaveBeenCalledWith('player-1', 0, 19, {
      signal: expect.any(AbortSignal)
    })
    expect(context.page.value?.queryParams.tag).toBeUndefined()
  })

  it('keeps explicit champion collection independent of the saved mode', async () => {
    usePlayerTabsStore().frontendSettings.defaultMatchHistoryTag = 'q_420'
    const { context } = mountMatchHistory({ initParams: { collectByChampionId: 103 } })
    await waitForLoad(context)

    expect(context.page.value?.isLoadedByCollectMode).toBe(true)
    expect(mocks.getSgpMatchHistory.mock.calls[0][1].tag).toBeUndefined()
  })

  it.each(['old-first', 'new-first'])('switches source during a slow query (%s)', async (order) => {
    const oldRequest = Promise.withResolvers<{ data: { games: [] } }>()
    const newRequest = Promise.withResolvers<{ data: { games: { games: [] } } }>()
    mocks.getSgpMatchHistory.mockReturnValueOnce(oldRequest.promise)
    mocks.getLcuMatchHistory.mockReturnValueOnce(newRequest.promise)
    const { context, source } = mountMatchHistory()
    source.value = 'lcu'
    await nextTick()

    expect(mocks.getLcuMatchHistory).toHaveBeenCalledTimes(1)
    expect(mocks.getSgpMatchHistory.mock.calls[0][1].signal.aborted).toBe(true)
    expect(mocks.getLcuMatchHistory.mock.calls[0][3].signal.aborted).toBe(false)
    if (order === 'old-first') {
      oldRequest.resolve({ data: { games: [] } })
      await nextTick()
      await nextTick()
      expect(context.page.value).toBeNull()
      expect(context.isLoading.value).toBe(true)
    }
    newRequest.resolve({ data: { games: { games: [] } } })
    await waitForLoad(context)
    const currentPage = context.page.value
    // A late failure from the previous source must not replace the page or show an error.
    if (order === 'new-first') oldRequest.reject(new Error('old SGP request failed'))
    await nextTick()
    await nextTick()
    expect(context.page.value).toBe(currentPage)
    expect(context.isLoading.value).toBe(false)
  })

  it('discards an old player/server query and starts the new target immediately', async () => {
    const oldRequest = Promise.withResolvers<{ data: { games: [] } }>()
    mocks.getSgpMatchHistory.mockReturnValueOnce(oldRequest.promise)
    const { context, puuid, serverId } = mountMatchHistory()
    puuid.value = 'player-2'
    serverId.value = 'HN1'
    await waitForLoad(context)
    expect(mocks.getSgpMatchHistory).toHaveBeenLastCalledWith(
      'player-2',
      expect.objectContaining({ __sgpServerId: 'HN1' })
    )
    const currentPage = context.page.value
    oldRequest.resolve({ data: { games: [] } })
    await nextTick()
    await nextTick()
    expect(context.page.value).toBe(currentPage)
  })

  it('switches to SGP while LCU summaries are still being completed', async () => {
    const pending = Promise.withResolvers<{ data: typeof lcuGameFixture }>()
    mocks.getLcuMatchHistory.mockResolvedValue({ data: { games: { games: [lcuGameFixture] } } })
    mocks.getLcuGame.mockReturnValueOnce(pending.promise)
    const { context, source } = mountMatchHistory({ source: 'lcu' })
    await vi.waitFor(() => expect(mocks.getLcuGame).toHaveBeenCalledTimes(1))
    source.value = 'sgp'
    await waitForLoad(context)
    const currentPage = context.page.value
    pending.resolve({ data: lcuGameFixture })
    await nextTick()
    await nextTick()
    expect(context.page.value).toBe(currentPage)
    expect(mocks.getLcuTimeline).not.toHaveBeenCalled()
    expect(usePlayerTabsStore().gameSummaryLruMap.has(`lcu:${lcuGameFixture.gameId}`)).toBe(false)
  })

  it("preserves this tab's SGP queue through a source switch, including an explicit all-modes choice", async () => {
    const store = usePlayerTabsStore()
    store.frontendSettings.defaultMatchHistoryTag = 'q_420'
    const { context, source } = mountMatchHistory()
    await waitForLoad(context)
    for (const tag of ['q_450', undefined]) {
      await context.loadMatchHistory({ tag })
      // A different tab may have changed the shared preference in the meantime.
      store.frontendSettings.defaultMatchHistoryTag = 'q_1700'
      source.value = 'lcu'
      await nextTick()
      await waitForLoad(context)
      expect(context.page.value?.queryParams.tag).toBeUndefined()
      source.value = 'sgp'
      await nextTick()
      await waitForLoad(context)
      expect(context.page.value?.queryParams.tag).toBe(tag)
    }
  })

  it('shares the in-flight detail load with manual expansion and clears its loading state', async () => {
    const details = Promise.withResolvers<{ data: typeof lcuTimelineFixture }>()
    mocks.getLcuMatchHistory.mockResolvedValue({ data: { games: { games: [lcuGameFixture] } } })
    mocks.getLcuTimeline.mockReturnValue(details.promise)
    const { context } = mountMatchHistory({ source: 'lcu' })
    await waitForLoad(context)
    expect(context.page.value?.detailsLoading[lcuGameFixture.gameId]).toBe(true)
    await context.loadDetails(lcuGameFixture.gameId)
    expect(mocks.getLcuTimeline).toHaveBeenCalledTimes(1)
    details.resolve({ data: lcuTimelineFixture })
    await vi.waitFor(() => {
      expect(context.page.value?.details[lcuGameFixture.gameId]?.source).toBe('lcu')
      expect(context.page.value?.detailsLoading[lcuGameFixture.gameId]).toBe(false)
    })
  })

  it('does not attach late details to a different page', async () => {
    const details = Promise.withResolvers<{ data: typeof lcuTimelineFixture }>()
    mocks.getLcuMatchHistory.mockResolvedValueOnce({ data: { games: { games: [lcuGameFixture] } } })
    mocks.getLcuTimeline.mockReturnValueOnce(details.promise)
    const { context } = mountMatchHistory({ source: 'lcu' })
    await waitForLoad(context)
    await context.loadMatchHistory({ startIndex: 20 })
    details.resolve({ data: lcuTimelineFixture })
    await nextTick()
    await nextTick()
    expect(context.page.value?.details).toEqual({})
    expect(context.page.value?.detailsLoading).toEqual({})
  })

  it('deduplicates queued details and cancels them when turning the page', async () => {
    const pending = Promise.withResolvers<{ data: typeof lcuTimelineFixture }>()
    const games = Array.from({ length: 6 }, (_, index) => ({
      ...lcuGameFixture,
      gameId: 100 + index
    }))
    mocks.getLcuMatchHistory.mockResolvedValueOnce({ data: { games: { games } } })
    mocks.getLcuTimeline.mockReturnValue(pending.promise)
    const { context } = mountMatchHistory({ source: 'lcu' })
    await waitForLoad(context)
    expect(mocks.getLcuTimeline).toHaveBeenCalledTimes(5)
    expect(context.page.value?.detailsLoading[105]).toBe(true)
    await context.loadDetails(105)
    await context.loadMatchHistory({ startIndex: 20 })
    expect(mocks.getLcuTimeline.mock.calls.every((call) => call[1].signal.aborted)).toBe(true)
    pending.resolve({ data: lcuTimelineFixture })
    await nextTick()
    await nextTick()
    expect(mocks.getLcuTimeline).toHaveBeenCalledTimes(5)
    expect(context.page.value?.details).toEqual({})
    expect(context.page.value?.detailsLoading).toEqual({})
  })

  it('allows a failed detail request to be retried without losing the summary', async () => {
    mocks.getLcuMatchHistory.mockResolvedValue({ data: { games: { games: [lcuGameFixture] } } })
    mocks.getLcuTimeline.mockRejectedValueOnce(new Error('timeline unavailable'))
    const { context } = mountMatchHistory({ source: 'lcu' })
    await waitForLoad(context)
    expect(context.page.value?.games).toHaveLength(1)
    await context.loadDetails(lcuGameFixture.gameId)
    expect(mocks.getLcuTimeline).toHaveBeenCalledTimes(2)
    expect(context.page.value?.details[lcuGameFixture.gameId]?.source).toBe('lcu')
  })

  it('keeps history usable when optional replay configuration fails', async () => {
    mocks.getLcuMatchHistory.mockResolvedValue({ data: { games: { games: [lcuGameFixture] } } })
    mocks.getReplayConfiguration.mockRejectedValue(new Error('replays unavailable'))
    const { context } = mountMatchHistory({ source: 'lcu' })
    await waitForLoad(context)
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('replay'),
      expect.any(Error)
    )
  })

  it('ignores a pending collection after the data source changes', async () => {
    const { context, source } = mountMatchHistory()
    await waitForLoad(context)
    const pending = Promise.withResolvers<{ data: typeof sgpHistoryFixture }>()
    mocks.getSgpMatchHistory.mockReturnValueOnce(pending.promise)
    const collecting = context.collectMatchHistory({
      countPerIteration: 20,
      maxIteration: 2,
      expectedCount: 40,
      filterState: createEmptyState()
    })
    source.value = 'lcu'
    await nextTick()
    expect(mocks.getLcuMatchHistory).toHaveBeenCalledTimes(1)
    await waitForLoad(context)
    const currentPage = context.page.value
    pending.resolve({ data: sgpHistoryFixture })
    await collecting
    expect(context.page.value).toBe(currentPage)
    expect(context.page.value?.isLoadedByCollectMode).toBe(false)
    expect(context.page.value?.games).toEqual([])
    expect(mocks.getSgpMatchHistory).toHaveBeenCalledTimes(2)
  })

  it('does not publish a result after the player tab has been closed', async () => {
    const pending = Promise.withResolvers<{ data: { games: [] } }>()
    mocks.getSgpMatchHistory.mockReturnValueOnce(pending.promise)
    const { context, unmount } = mountMatchHistory()
    unmount()
    expect(mocks.getSgpMatchHistory.mock.calls[0][1].signal.aborted).toBe(true)
    pending.resolve({ data: { games: [] } })
    await nextTick()
    await nextTick()
    expect(context.page.value).toBeNull()
    expect(mocks.getReplayConfiguration).not.toHaveBeenCalled()
  })
})
