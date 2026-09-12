import { type OpggContext, OpggContextKey } from '@opgg-window/opgg/context'
import OpggChampionBoots from '@opgg-window/opgg/widgets/OpggChampionBoots.vue'
import OpggChampionCoreItems from '@opgg-window/opgg/widgets/OpggChampionCoreItems.vue'
import OpggChampionKiwiAugments from '@opgg-window/opgg/widgets/OpggChampionKiwiAugments.vue'
import OpggChampionLastItems from '@opgg-window/opgg/widgets/OpggChampionLastItems.vue'
import OpggChampionStarterItems from '@opgg-window/opgg/widgets/OpggChampionStarterItems.vue'
import type {
  OpggAramMayhemChampionAugmentItem,
  OpggChampionBuildResponse
} from '@shared/types/opgg'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { provide, ref } from 'vue'

// Synthetic UI fixtures: no network statistics and no LCU writes.
const recommendations = (ids: number[][]) =>
  ids.map((ids) => ({ ids, play: 0, win: 0, pick_rate: 0, is_recommendation_only: true }))
const meta = {
  title: 'Renderer Shared/Champion Data/Mayhem',
  parameters: { akariStoryPanelMaxWidth: 960 },
  render: () => ({
    components: {
      OpggChampionKiwiAugments,
      OpggChampionCoreItems,
      OpggChampionBoots,
      OpggChampionStarterItems,
      OpggChampionLastItems
    },
    setup() {
      const data: OpggAramMayhemChampionAugmentItem[] = Array.from({ length: 36 }, (_, i) => ({
        id: 1000 + i,
        tier: i % 7,
        performance: 80 - i * 0.5,
        popular: 20 - i * 0.3,
        display: {
          name: ['虚幻武器', '神射法师', '珠光护手'][i % 3] + (i > 2 ? ` · 演示 ${i}` : ''),
          description: '界面演示说明。这里展示来源提供的强化描述，不执行 HTML。',
          rarity: (['kSilver', 'kGold', 'kPrismatic'] as const)[i % 3]
        }
      }))
      provide(OpggContextKey, {
        champion: ref({
          data: {
            core_items: recommendations([
              [3100, 3089, 3137],
              [4645, 3089, 3135]
            ]),
            boots: recommendations([[3020], [3158]]),
            starter_items: recommendations([
              [1058, 2003],
              [1026, 1001]
            ]),
            last_items: recommendations([[3157], [3135], [4645], [4630]])
          },
          meta: { version: '16.18' }
        } as unknown as OpggChampionBuildResponse),
        kiwiAugments: ref({ data }),
        effectiveSource: ref('opgg'),
        mode: ref('aram_mayhem')
      } as OpggContext)
    },
    template: `<div class="text-xs">
      <div class="mb-3 opacity-70">海克斯乱斗 · 界面演示（合成数据）</div>
      <OpggChampionKiwiAugments />
      <div class="grid grid-cols-1 gap-1 @min-[750px]:grid-cols-2">
        <OpggChampionCoreItems /><OpggChampionBoots /><OpggChampionStarterItems /><OpggChampionLastItems />
      </div>
    </div>`
  })
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Recommendations: Story = {}
export const Narrow: Story = { parameters: { akariStoryPanelMaxWidth: 560 } }
