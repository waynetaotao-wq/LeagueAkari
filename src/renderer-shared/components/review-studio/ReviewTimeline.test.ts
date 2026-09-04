import { compile } from '@vue/compiler-dom'
import { compileScript, parse } from '@vue/compiler-sfc'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as Vue from 'vue'
import {
  type Component,
  createRenderer,
  defineComponent,
  h,
  nextTick,
  reactive,
  ssrContextKey
} from 'vue'

import ReviewTimeline from './ReviewTimeline.vue'
import timelineSource from './ReviewTimeline.vue?raw'
import type { ReviewMatch } from './types'

// Mount the real player with Vue's renderer. Native controls are host nodes in this unit
// harness; these tests do not claim to verify DOM layout or Naive UI appearance.
// The repository's node environment imports an SSR SFC. Recompile that same template
// for our client host, retaining the real imported setup and all interaction handlers.
const { descriptor } = parse(timelineSource)
const bindings = compileScript(descriptor, { id: 'review-timeline-test' }).bindings
ReviewTimeline.render = new Function(
  'Vue',
  compile(descriptor.template!.content, {
    mode: 'function',
    prefixIdentifiers: true,
    bindingMetadata: bindings
  }).code
)(Vue)
vi.mock('naive-ui', async () => {
  const { defineComponent, h } = await import('vue')
  const result: Record<string, Component | (() => unknown)> = {}
  for (const name of [
    'NButton',
    'NCard',
    'NCheckbox',
    'NDivider',
    'NEmpty',
    'NRadioButton',
    'NRadioGroup',
    'NScrollbar',
    'NSelect',
    'NSlider',
    'NTag',
    'NText',
    'NTooltip'
  ]) {
    result[name] = defineComponent({
      inheritAttrs: false,
      setup:
        (_, { attrs, slots }) =>
        () =>
          h(name, attrs, name === 'NTooltip' ? slots.trigger?.() : slots.default?.())
    })
  }
  result.useThemeVars = () => ({ value: { warningColor: '#aa0', textColor1: '#fff' } })
  return result
})
vi.mock('@renderer-shared/providers/akari-resource', () => ({
  useAkariResourceProvider: () => ({ champions: { name: (id: number) => `英雄 ${id}` } })
}))
vi.mock('@renderer-shared/components/widgets/ChampionIcon.vue', () => ({
  default: { props: ['championId'], render: () => null }
}))
vi.mock('@renderer-shared/components/match-card/utils/theme', () => ({
  getTeamColor: () => '#888'
}))

interface HostNode {
  type: string
  text: string
  children: HostNode[]
  props: Record<string, unknown>
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
  patchProp: (target, key, _previous, next) => {
    target.props[key] = next
  }
})

function fixture(): ReviewMatch {
  const participants: ReviewMatch['participants'] = [1, 2].map((participantId) => ({
    participantId,
    puuid: String(participantId),
    championId: participantId,
    championName: '',
    name: '',
    teamId: participantId === 1 ? 100 : 200,
    position: 'MIDDLE',
    win: true
  }))
  return {
    meta: {
      gameId: 1,
      sgpServerId: 'KR',
      puuid: '1',
      gameCreation: 0,
      gameDuration: 600,
      queueId: 420,
      patch: '16.17',
      championId: 1,
      position: 'MIDDLE',
      participantId: 1,
      teamId: 100,
      opponentId: 2,
      opponentChampionId: 2,
      win: true
    },
    participants,
    frames: [0, 60_000, 120_000, 180_000].map((timestamp) => ({
      timestamp,
      personalGoldDiff: 0,
      personalCsDiff: 0,
      teamGoldDiff: 0,
      participants: participants.map((participant) => ({
        participantId: participant.participantId,
        position: { x: 6000, y: 6000 },
        gold: 500,
        cs: 10,
        level: 2,
        alive: true
      }))
    })),
    events: [],
    moments: [],
    snapshots: [],
    quality: {
      expectedFrames: 4,
      missingFrames: 0,
      timelineCoverage: 1,
      validGoldSnapshots: 0,
      validCsSnapshots: 0,
      validTeamSnapshots: 0,
      eventCoverage: 'complete',
      warnings: []
    }
  }
}
function nodes(root: HostNode): HostNode[] {
  return [root, ...root.children.flatMap(nodes)]
}
function label(root: HostNode): string {
  return root.text + root.children.map(label).join('')
}
function mount(model = fixture()) {
  const documentMock = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }
  vi.stubGlobal('document', documentMock)
  const state = reactive({ model, active: true, frameIndex: 0, seekToken: 0 })
  const root = node('root')
  const app = renderer.createApp(
    defineComponent({
      setup: () => () =>
        h(ReviewTimeline, {
          ...state,
          onFrame: (index: number) => {
            state.frameIndex = index
          }
        })
    })
  )
  app.provide(ssrContextKey, { modules: new Set() })
  app.mount(root)
  const click = async (text: string) => {
    const button = nodes(root).find((entry) => entry.type === 'NButton' && label(entry) === text)
    expect(button, `button ${text}`).toBeDefined()
    ;(button!.props.onClick as () => void)()
    await nextTick()
  }
  return { state, root, app, click, documentMock }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('review timeline playback', () => {
  it('plays discrete frames and stops on hide, manual seek, and unmount', async () => {
    vi.useFakeTimers()
    const view = mount()
    await view.click('播放')
    await vi.advanceTimersByTimeAsync(1000)
    expect(view.state.frameIndex).toBe(1)
    view.state.active = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(2000)
    expect(view.state.frameIndex).toBe(1)
    view.state.active = true
    await nextTick()
    await view.click('播放')
    view.state.seekToken++
    await nextTick()
    await vi.advanceTimersByTimeAsync(2000)
    expect(view.state.frameIndex).toBe(1)
    await view.click('播放')
    view.app.unmount()
    await vi.advanceTimersByTimeAsync(2000)
    expect(view.state.frameIndex).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('does not draw dead heroes or heroes without position data', async () => {
    const model = fixture()
    model.frames[0].participants[0].alive = false
    model.frames[0].participants[1].position = null
    const view = mount(model)
    expect(
      nodes(view.root).filter(
        (entry) => entry.type === 'NButton' && String(entry.props['aria-label']).includes('英雄')
      )
    ).toHaveLength(0)
    expect(label(view.root)).toContain('该帧已死亡')
    view.app.unmount()
  })
  it('stops when the document is hidden and does not auto-resume', async () => {
    vi.useFakeTimers()
    const view = mount()
    await view.click('播放')
    view.documentMock.hidden = true
    const listener = view.documentMock.addEventListener.mock.calls.find(
      ([type]) => type === 'visibilitychange'
    )?.[1] as () => void
    listener()
    await vi.advanceTimersByTimeAsync(1500)
    expect(view.state.frameIndex).toBe(0)
    view.documentMock.hidden = false
    listener()
    await vi.advanceTimersByTimeAsync(1500)
    expect(view.state.frameIndex).toBe(0)
    view.app.unmount()
  })
  it('stops at the last real frame and replays from the beginning', async () => {
    vi.useFakeTimers()
    const view = mount()
    await view.click('播放')
    await vi.advanceTimersByTimeAsync(3000)
    expect(view.state.frameIndex).toBe(3)
    expect(vi.getTimerCount()).toBe(0)
    await view.click('重播')
    expect(view.state.frameIndex).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(view.state.frameIndex).toBe(1)
    view.app.unmount()
  })
})
