import 'reflect-metadata'

import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import type { ChampSelectSession } from '@shared/types/league-client/champ-select'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { NButton, NSelect } from 'naive-ui'
import { computed, getCurrentInstance, onBeforeUnmount, provide, ref, watch } from 'vue'

import { type OpggContext, OpggContextKey } from '../../context'
import {
  hasCompleteMatchupLoadout,
  matchupOverlay,
  matchupOverlayIdentity
} from '../../matchup-overlay'
import OpggCounterIntel from './OpggCounterIntel.vue'
import { draftBuild, draftPriors, draftSession } from './fixtures'

const rounds = [[], [22], [22, 41], [22, 41, 86], [22, 41, 86, 64, 89]]
const meta = {
  title: 'OP.GG/Progressive Draft',
  parameters: { akariStoryPanelMaxWidth: 560 },
  render: () => ({
    components: { OpggCounterIntel, NButton, NSelect },
    setup() {
      const state = useLeagueClientStore()
      const globals = getCurrentInstance()!.appContext.config.globalProperties
      const previousManager = globals.$akariManager
      const previousSession = state.champSelect.session
      const previousPhase = state.gameflow.phase
      const round = ref(1)
      const position = ref('mid')
      const mockIpc = {
        onEventVue: () => () => {},
        async call(_namespace: string, method: string, query: any) {
          if (method === 'counterIntel/rolePriors') return draftPriors
          if (method === 'counterIntel/matchupBuild') return draftBuild(query)
          if (method === 'counterIntel/bzGuide') return { found: false }
          if (method === 'counterIntel/get')
            return { ...query, rows: [], laneKillAvailable: false, sourceVersion: '16.18' }
          throw new Error(`Unsupported preview request: ${method}`)
        }
      }
      globals.$akariManager = { getInstance: () => mockIpc } as unknown as typeof previousManager
      provide(OpggContextKey, {
        region: ref('kr'),
        tier: ref('emerald_plus'),
        championId: ref(238),
        mode: ref('ranked'),
        position,
        version: ref('16.18'),
        effectiveSource: ref('opgg'),
        syncAutomaticLoadout: () => {},
        setMatchupLoadoutPending: () => {},
        changePosition: async (value: string) => {
          position.value = value
        }
      } as unknown as OpggContext)
      state.gameflow.phase = 'ChampSelect'
      watch(
        round,
        (value) => {
          state.champSelect.session = draftSession(rounds[value]) as unknown as ChampSelectSession
        },
        { immediate: true }
      )
      onBeforeUnmount(() => {
        globals.$akariManager = previousManager
        state.champSelect.session = previousSession
        state.gameflow.phase = previousPhase
      })
      return {
        round,
        options: [
          '未选人',
          '第一轮：低倾向候选',
          '第二轮：更可能的候选',
          '第三轮：同一候选更明确',
          '五人选齐'
        ].map((label, value) => ({ label, value })),
        opponent: computed(() => matchupOverlayIdentity.value?.opponentChampionId ?? '等待'),
        automatic: computed(() =>
          hasCompleteMatchupLoadout(matchupOverlay.value) ? '对位构筑' : '通用构筑'
        )
      }
    },
    template: `<div>
      <div class="mb-2 text-xs opacity-70">模拟选人 · 示例倾向数据 · 不连接游戏</div>
      <NSelect v-model:value="round" :options="options" size="small" />
      <div class="my-2 flex gap-2">
        <NButton size="small" :disabled="round === 0" @click="round--">上一轮</NButton>
        <NButton size="small" :disabled="round === 4" @click="round++">下一轮</NButton>
      </div>
      <OpggCounterIntel />
      <div class="mt-2 text-xs opacity-70">预览对手 ID：{{ opponent }} · 自动配置：{{ automatic }}</div>
    </div>`
  })
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
export const Rounds: Story = {}
export const Narrow: Story = { parameters: { akariStoryPanelMaxWidth: 300 } }
