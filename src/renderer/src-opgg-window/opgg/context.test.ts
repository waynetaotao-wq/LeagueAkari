import type { ChampionDataOverview, ChampionDataQuery } from '@shared/data-adapter/champion-data'
import { adaptOpggMayhemDetails, adaptOpggMayhemOverview } from '@shared/data-adapter/champion-data'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRenderer, h, nextTick, reactive } from 'vue'

import { type OpggContext, provideOpgg, useOpgg } from './context'

const mocks = vi.hoisted(() => ({
  instance: vi.fn(),
  store: vi.fn(),
  ogStore: vi.fn(),
  lcStore: vi.fn(),
  error: vi.fn()
}))
vi.mock('@renderer-shared/shards', () => ({ useInstance: mocks.instance }))
vi.mock('@opgg-window/shards/opgg', () => ({ OpggRenderer: class {} }))
vi.mock('@renderer-shared/shards/champion-data', () => ({ ChampionDataRenderer: class {} }))
vi.mock('@opgg-window/shards/opgg/store', () => ({ useOpggStore: mocks.ogStore }))
vi.mock('@renderer-shared/shards/champion-data/store', () => ({
  useChampionDataStore: mocks.store
}))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: mocks.lcStore
}))
vi.mock('@renderer-shared/shards/auto-champ-config/store', () => ({
  useAutoChampConfigStore: () => ({ settings: { runesV2: {}, summonerSpells: {} } })
}))
vi.mock('./utils/loadout', () => ({
  hasItemsSets: () => false,
  useLoadout: () => ({ setSummonerSpells: vi.fn(), setRunes: vi.fn(), writeItemSets: vi.fn() })
}))
vi.mock('i18next-vue', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('naive-ui', () => ({ useMessage: () => ({ error: mocks.error, warning: vi.fn() }) }))

const renderer = createRenderer<any, any>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  parentNode: () => null,
  nextSibling: () => null,
  insert() {},
  remove() {},
  patchProp() {}
})
let app: ReturnType<typeof renderer.createApp> | null = null
const success = (data: any, source = 'opgg') => ({
  status: 'success',
  preferredSource: source,
  effectiveSource: source,
  fallbackReason: null,
  attempts: [],
  data
})
function overview(query: ChampionDataQuery): ChampionDataOverview {
  return {
    metadata: {
      source: query.source!,
      mode: query.mode,
      patch: query.patch!,
      updatedAt: null,
      dataDate: null
    },
    sections: { champions: [] }
  }
}
async function settle() {
  for (let i = 0; i < 20; i++) await nextTick()
}
async function mount() {
  vi.stubGlobal('document', { visibilityState: 'hidden' })
  const store = reactive({
    settings: {
      preferredSource: 'opgg',
      preferences: {
        mode: 'ranked',
        region: 'euw',
        tier: 'challenger',
        position: 'middle'
      }
    },
    availability: {
      sources: { opgg: { enabled: true }, lolps: { enabled: true }, qq101: { enabled: true } }
    }
  })
  const api = {
    updatePreferences: vi.fn(),
    setPreferences: vi.fn(),
    setPreferredSource: vi.fn(async (source) => {
      store.settings.preferredSource = source
    }),
    loadPatches: vi.fn(async (query) =>
      success([query.source === 'lolps' ? '26.18' : '16.18'], query.source)
    ),
    loadOverview: vi.fn(async (query) => success(overview(query), query.source)),
    loadDetails: vi.fn()
  }
  mocks.instance.mockReturnValue(api)
  mocks.store.mockReturnValue(store)
  mocks.ogStore.mockReturnValue({
    savedPreferences: { flashPosition: 'auto' },
    frontendSettings: {}
  })
  const lcs = reactive({
    champSelect: { session: null as any, disabledChampionIds: new Set<number>() },
    gameflow: { session: null as any, phase: 'None' }
  })
  mocks.lcStore.mockReturnValue(lcs)
  let context!: OpggContext
  app = renderer.createApp({
    setup() {
      provideOpgg()
      return () =>
        h({
          setup() {
            context = useOpgg()
            return () => null
          }
        })
    }
  })
  app.mount({})
  await settle()
  return { context, api, store, lcs }
}
afterEach(() => {
  app?.unmount()
  app = null
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('source/filter request lifecycle', () => {
  it('opens Mayhem items for the assigned champion and follows rerolls despite an older pick action', async () => {
    vi.useFakeTimers()
    const { context, api, lcs } = await mount()
    const champions = [238, 245].map((champion_id) => ({
      id: champion_id,
      champion_id,
      tier: 2,
      rank: 10
    }))
    api.loadOverview.mockImplementation(async (query) =>
      success(adaptOpggMayhemOverview({ data: champions }, {}), query.source)
    )
    api.loadDetails.mockImplementation(async (query, id) => {
      const details = adaptOpggMayhemDetails(
        champions.find((c) => c.champion_id === id)!,
        { data: [] },
        {}
      )
      details.sections.itemBuilds = [
        {
          slot: 'core',
          options: [
            {
              itemIds: id === 238 ? [126697, 6696] : [3152, 4645],
              performance: {
                games: null,
                wins: null,
                winRate: null,
                pickRate: null,
                rank: null,
                averagePlacement: null,
                firstPlaceRate: null
              }
            }
          ]
        }
      ]
      return success(details, query.source)
    })
    lcs.gameflow.phase = 'ChampSelect'
    lcs.gameflow.session = { gameData: { queue: { gameMode: 'KIWI', type: 'ARAM_UNRANKED_5x5' } } }
    lcs.champSelect.session = {
      id: 'mayhem-session',
      gameId: 17,
      localPlayerCellId: 0,
      myTeam: [{ cellId: 0, championId: 238, assignedPosition: '' }],
      actions: [[{ actorCellId: 0, type: 'pick', championId: 238, completed: true }]]
    }
    await settle()
    await vi.advanceTimersByTimeAsync(501)
    await settle()
    expect(context.currentTab.value).toBe('champion')
    expect(context.mode.value).toBe('aram_mayhem')
    expect(context.champion.value?.data.core_items[0].ids).toEqual([126697, 6696])
    expect(api.loadDetails.mock.lastCall?.[0]).toEqual({ source: 'opgg', mode: 'aram_mayhem' })

    lcs.champSelect.session.myTeam[0].championId = 245
    await settle()
    await vi.advanceTimersByTimeAsync(501)
    await settle()
    expect(context.champion.value?.data.summary.id).toBe(245)
    expect(context.champion.value?.data.core_items[0].ids).toEqual([3152, 4645])
  })

  it('switches from unsupported region/rank once, with labels and loaded data agreeing', async () => {
    const { context, api } = await mount()
    api.loadOverview.mockClear()
    await context.changeSource('lolps')
    await settle()
    expect(api.loadOverview).toHaveBeenCalledTimes(1)
    expect(api.loadOverview.mock.calls[0][0]).toEqual({
      source: 'lolps',
      mode: 'ranked',
      region: 'kr',
      tier: 'emerald_plus',
      patch: '26.18',
      position: 'middle'
    })
    expect([
      context.effectiveSource.value,
      context.region.value,
      context.tier.value,
      context.version.value
    ]).toEqual(['lolps', 'kr', 'emerald_plus', '26.18'])
    await context.changeRegion('na')
    await context.changeTier('diamond_plus')
    await context.changeSource('opgg')
    expect([context.region.value, context.tier.value, context.version.value]).toEqual([
      'na',
      'diamond_plus',
      '16.18'
    ])
  })

  it('keeps the latest data after an older failure arrives and blocks dependent statistics while loading', async () => {
    const { context, api } = await mount()
    let resolveOld!: (result: any) => void
    api.loadOverview.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve
        })
    )
    const old = context.changeRegion('kr')
    await settle()
    expect(context.effectiveSource.value).toBeNull()
    const latest = context.changeRegion('na')
    resolveOld({
      status: 'unavailable',
      effectiveSource: null,
      fallbackReason: 'request-failed',
      attempts: [{ outcome: 'failed' }]
    })
    await Promise.all([old, latest])
    expect(context.region.value).toBe('na')
    expect(context.effectiveSource.value).toBe('opgg')
    expect(context.overview.value?.metadata.source).toBe('opgg')
    expect(context.isDataUnavailable.value).toBe(false)
    expect(mocks.error).not.toHaveBeenCalled()
  })
})
