import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { ModuleKind, ScriptTarget, transpileModule } from 'typescript'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import { createRenderer, nextTick, reactive, ref, ssrContextKey } from 'vue'

import {
  hasCompleteMatchupLoadout,
  matchupOverlay,
  matchupOverlayIdentity
} from '../../matchup-overlay'
import OpggCounterIntel from './OpggCounterIntel.vue'
import source from './OpggCounterIntel.vue?raw'
import { draftBuild, draftPriors, draftSession } from './fixtures'

const mocks = vi.hoisted(() => ({
  store: vi.fn(),
  context: vi.fn(),
  call: vi.fn(),
  sync: vi.fn(),
  pending: vi.fn()
}))
vi.mock('@renderer-shared/shards/league-client/store', () => ({
  useLeagueClientStore: mocks.store
}))
vi.mock('../../context', () => ({ useOpgg: mocks.context }))
vi.mock('@renderer-shared/shards', () => ({
  useInstance: () => ({ call: mocks.call, onEventVue: () => () => {} })
}))
vi.mock('@renderer-shared/shards/league-client', () => ({ LeagueClientRenderer: class {} }))
vi.mock('@renderer-shared/shards/ipc', () => ({ AkariIpcRenderer: class {} }))
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({ champions: { name: (id: number) => `英雄 ${id}` } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({
  default: { render: () => null }
}))
vi.mock('@renderer-shared/components/bz-guide/BzImageLoadout.vue', () => ({
  default: { render: () => null }
}))
vi.mock('@vicons/ionicons5', () => ({ RefreshSharp: { render: () => null } }))
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  return Object.fromEntries(
    ['NButton', 'NIcon', 'NScrollbar', 'NSelect', 'NSpin', 'NSwitch'].map((name) => [
      name,
      defineComponent({
        inheritAttrs: false,
        setup:
          (_, { attrs, slots }) =>
          () =>
            h(name, attrs, slots.default?.())
      })
    ])
  )
})

// Mount real setup/watchers and template on a Vue host. IPC is simulated; these tests
// verify draft-to-preview/write eligibility and stale responses, not actual LCU writes or layout.
const { descriptor } = parse(source)
OpggCounterIntel.render = new Function(
  'Vue',
  transpileModule(
    compile(descriptor.template!.content, {
      mode: 'function',
      prefixIdentifiers: true,
      bindingMetadata: compileScript(descriptor, { id: 'counter-intel-test' }).bindings
    }).code,
    { compilerOptions: { target: ScriptTarget.ESNext, module: ModuleKind.None } }
  ).outputText
)(Vue)

interface HostNode {
  type: string
  text: string
  children: HostNode[]
  props: Record<string, any>
  parent?: HostNode
}
const node = (type: string, text = ''): HostNode => ({ type, text, children: [], props: {} })
const renderer = createRenderer<HostNode, HostNode>({
  createElement: (tag) => node(tag),
  createText: (value) => node('text', value),
  createComment: () => node('comment'),
  setText: (target, value) => {
    target.text = value
  },
  setElementText: (target, value) => {
    target.text = value
    target.children = []
  },
  parentNode: (target) => target.parent ?? null,
  nextSibling: (target) => {
    const siblings = target.parent?.children ?? []
    return siblings[siblings.indexOf(target) + 1] ?? null
  },
  insert: (target, parent, anchor) => {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
    target.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    if (index < 0) parent.children.push(target)
    else parent.children.splice(index, 0, target)
  },
  remove: (target) => {
    if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
  },
  patchProp: (target, key, _previous, value) => {
    target.props[key] = value
  }
})
const nodes = (root: HostNode): HostNode[] => [root, ...root.children.flatMap(nodes)]
const label = (root: HostNode): string => root.text + root.children.map(label).join('')
let app: ReturnType<typeof renderer.createApp> | null = null

function mount(ids: number[] = []) {
  vi.useFakeTimers()
  vi.stubGlobal('document', {
    visibilityState: 'visible',
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  })
  const state = reactive({
    champSelect: { session: draftSession(ids), currentPickableChampionIds: new Set() },
    gameflow: { phase: 'ChampSelect', session: null },
    summoner: { me: null }
  })
  mocks.store.mockReturnValue(state)
  mocks.context.mockReturnValue({
    region: ref('kr'),
    tier: ref('emerald_plus'),
    championId: ref(238),
    mode: ref('ranked'),
    position: ref('mid'),
    version: ref('16.18'),
    effectiveSource: ref('opgg'),
    syncAutomaticLoadout: mocks.sync,
    setMatchupLoadoutPending: mocks.pending,
    changePosition: vi.fn()
  })
  mocks.call.mockImplementation(async (_namespace, method, query) => {
    if (method === 'counterIntel/rolePriors') return draftPriors
    if (method === 'counterIntel/matchupBuild') return draftBuild(query)
    if (method === 'counterIntel/bzGuide') return { found: false }
    if (method === 'counterIntel/get') return { ...query, rows: [], laneKillAvailable: false }
    throw new Error(`Unexpected request ${method}`)
  })
  const root = node('root')
  app = renderer.createApp(OpggCounterIntel)
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  return { state, root }
}

async function settle() {
  await nextTick()
  await vi.advanceTimersByTimeAsync(600)
  await nextTick()
}
function buildCalls() {
  return mocks.call.mock.calls.filter(([, method]) => method === 'counterIntel/matchupBuild')
}

afterEach(() => {
  app?.unmount()
  app = null
  vi.clearAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('progressive draft matchup', () => {
  it('previews from the first pick, switches to a stronger candidate, and reevaluates the same candidate without refetching', async () => {
    const view = mount()
    await settle()
    expect(buildCalls()).toHaveLength(0)
    view.state.champSelect.session = draftSession([22])
    await settle()
    expect(label(view.root)).toContain('初步推测：英雄 22')
    expect(label(view.root)).toContain('敌方已选 1/5')
    expect(matchupOverlayIdentity.value?.opponentChampionId).toBe(22)
    expect(hasCompleteMatchupLoadout(matchupOverlay.value)).toBe(false)

    view.state.champSelect.session = draftSession([22, 41])
    await settle()
    expect(label(view.root)).toContain('初步推测：英雄 41')
    expect(matchupOverlayIdentity.value?.opponentChampionId).toBe(41)
    expect(hasCompleteMatchupLoadout(matchupOverlay.value)).toBe(false)
    const calls = buildCalls().length
    mocks.sync.mockClear()

    view.state.champSelect.session = draftSession([22, 41, 86])
    await settle()
    expect(label(view.root)).toContain('推测对位：英雄 41')
    expect(label(view.root)).not.toContain('初步推测')
    expect(hasCompleteMatchupLoadout(matchupOverlay.value)).toBe(true)
    expect(buildCalls()).toHaveLength(calls)
    expect(mocks.sync).toHaveBeenCalled()

    view.state.champSelect.session = draftSession([22, 41, 86, 64, 89])
    await settle()
    expect(label(view.root)).toContain('敌方已选 5/5')
    expect(matchupOverlayIdentity.value?.opponentChampionId).toBe(41)
    expect(buildCalls()).toHaveLength(calls)
    view.state.champSelect.session = draftSession([22, 41])
    await settle()
    expect(hasCompleteMatchupLoadout(matchupOverlay.value)).toBe(false)
    expect(label(view.root)).toContain('自动配置暂用通用构筑')
  })

  it('honors manual selection, resumes inference on Auto, and prioritizes a client-assigned lane', async () => {
    const view = mount([22, 41])
    await settle()
    nodes(view.root)
      .find((n) => n.type === 'NSwitch')!
      .props['onUpdate:value'](true)
    await nextTick()
    const select = nodes(view.root).find(
      (n) => n.type === 'NSelect' && n.props.options[0]?.value === 0
    )!
    select.props['onUpdate:value'](22)
    await settle()
    view.state.champSelect.session = draftSession([22, 41, 86])
    await settle()
    expect(label(view.root)).toContain('手动指定：英雄 22')
    expect(matchupOverlayIdentity.value?.opponentChampionId).toBe(22)
    expect(hasCompleteMatchupLoadout(matchupOverlay.value)).toBe(true)
    select.props['onUpdate:value'](0)
    await settle()
    expect(matchupOverlayIdentity.value?.opponentChampionId).toBe(41)
    const assigned = draftSession([22, 41, 86])
    assigned.theirTeam[0].assignedPosition = 'middle'
    view.state.champSelect.session = assigned
    await settle()
    expect(matchupOverlayIdentity.value?.opponentChampionId).toBe(22)
    expect(label(view.root)).toContain('客户端分路')
  })

  it('rejects late builds and Bz results after a new candidate or new draft replaces them', async () => {
    const view = mount()
    await settle()
    const normal = mocks.call.getMockImplementation()!
    const pending: Array<() => void> = []
    mocks.call.mockImplementation((namespace, method, query) => {
      if (query?.opponentChampionId === 22 && method === 'counterIntel/matchupBuild') {
        return new Promise((resolve) => pending.push(() => resolve(draftBuild(query))))
      }
      if (query?.opponentChampionId === 22 && method === 'counterIntel/bzGuide') {
        return new Promise((resolve) =>
          pending.push(() => resolve({ found: true, row: { champion: 'OLD BZ' } }))
        )
      }
      return normal(namespace, method, query)
    })
    view.state.champSelect.session = draftSession([22])
    await settle()
    expect(pending).toHaveLength(2)
    view.state.champSelect.session = draftSession([22, 41])
    await settle()
    expect(matchupOverlayIdentity.value?.opponentChampionId).toBe(41)
    for (const resolve of pending.splice(0)) resolve()
    await settle()
    expect(matchupOverlayIdentity.value?.opponentChampionId).toBe(41)
    expect(label(view.root)).not.toContain('OLD BZ')
    view.state.champSelect.session = draftSession([22])
    await settle()
    view.state.champSelect.session = draftSession([41], 202)
    await settle()
    for (const resolve of pending) resolve()
    await settle()
    expect(matchupOverlayIdentity.value).toMatchObject({ gameId: 202, opponentChampionId: 41 })
    expect(label(view.root)).not.toContain('OLD BZ')
  })
})
