import type { BzMatchupRow } from '@shared/types/counter-intel'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { NSelect } from 'naive-ui'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

import cleanse from '../../../main/shards/champion-data/bz-guide/fixtures/Cleanse.png?inline'
import flash from '../../../main/shards/champion-data/bz-guide/fixtures/Flash.png?inline'
import ignite from '../../../main/shards/champion-data/bz-guide/fixtures/Ignite.png?inline'
import BzImageLoadout from './BzImageLoadout.vue'

// UI scenarios only: switching samples does not contact Google or write to the League client.
const row: BzMatchupRow = {
  champion: 'Ahri',
  rune: 'Electrocute',
  difficulty: 'Hard',
  coreBuild: 'Voltaic → LDR',
  summary: '界面演示',
  keystonePerkId: 8112,
  sourceFormat: 'xlsx',
  sourceSheet: 'Zed Matchups',
  sourceRow: 8,
  imageLoadout: {
    status: 'ready',
    catalogVersion: '16.18.1',
    spellIds: [4, 14],
    starterItemId: 1055,
    issues: []
  }
}
const scenarios: Array<{ label: string; row: BzMatchupRow }> = [
  { label: '在线图片 · 阿狸', row },
  {
    label: '图片更新 · 墨菲特',
    row: {
      ...row,
      champion: 'Malphite',
      sourceRow: 40,
      imageLoadout: { ...row.imageLoadout!, spellIds: [4, 12], starterItemId: 1054 }
    }
  },
  {
    label: '技能重叠 · 丽桑卓',
    row: {
      ...row,
      champion: 'Lissandr',
      sourceRow: 36,
      imageLoadout: {
        ...row.imageLoadout!,
        status: 'partial',
        spellIds: undefined,
        issues: [
          { code: 'overlapping-images', field: 'spells' },
          { code: 'ambiguous-spells', field: 'spells' }
        ],
        previews: [flash, ignite, cleanse]
      }
    }
  },
  {
    label: '图片源不可用',
    row: {
      ...row,
      sourceRow: undefined,
      sourceFormat: 'csv',
      imageLoadout: {
        status: 'unavailable',
        issues: [{ code: 'source-unavailable', field: 'both' }]
      }
    }
  },
  { label: '旧缓存', row: { ...row, stale: true } }
]
const reference: BzMatchupRow = {
  ...row,
  stale: true,
  refreshing: true,
  imageReference: {
    loadout: row.imageLoadout!,
    fetchedAt: 1789314000000,
    sourceSheet: row.sourceSheet,
    sourceRow: row.sourceRow,
    reason: 'refreshing'
  }
}
scenarios.push(
  { label: '自动显示记录 · 同步中', row: reference },
  {
    label: '自动显示记录 · 网络故障',
    row: {
      ...reference,
      refreshing: false,
      imageReference: { ...reference.imageReference!, reason: 'source-unavailable' }
    }
  },
  {
    label: '自动显示记录 · 资源库故障',
    row: {
      ...reference,
      stale: false,
      refreshing: false,
      imageReference: { ...reference.imageReference!, reason: 'catalog-unavailable' }
    }
  }
)
const meta = {
  title: 'Renderer Shared/Champion Data/Bz Images',
  parameters: { akariStoryPanelMaxWidth: 360 },
  render: () => ({
    components: { BzImageLoadout, NSelect },
    setup() {
      const selected = ref(0)
      return {
        selected,
        options: scenarios.map((s, i) => ({ label: s.label, value: i })),
        current: computed(() => scenarios[selected.value].row)
      }
    },
    template: `<div class="text-xs">
      <div class="mb-2 opacity-70">Bz 图片同步 · 界面演示</div>
      <NSelect v-model:value="selected" :options="options" size="small" />
      <div class="mt-3 font-bold">Bz 推荐 · vs {{ current.champion }}</div>
      <BzImageLoadout :row="current" />
    </div>`
  })
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const States: Story = {}
export const Narrow: Story = { parameters: { akariStoryPanelMaxWidth: 280 } }
export const AutoRecovery: Story = {
  render: () => ({
    components: { BzImageLoadout },
    setup() {
      const current = ref(reference)
      let timer: ReturnType<typeof setTimeout>
      onMounted(() => {
        timer = setTimeout(() => {
          current.value = {
            ...row,
            imageLoadout: { ...row.imageLoadout!, starterItemId: 1054 }
          }
        }, 5000)
      })
      onBeforeUnmount(() => clearTimeout(timer))
      return { current }
    },
    template: `<div class="text-xs"><div class="mb-2 opacity-70">自动恢复演示 · 5 秒后收到新图片</div><BzImageLoadout :row="current" /></div>`
  })
}
