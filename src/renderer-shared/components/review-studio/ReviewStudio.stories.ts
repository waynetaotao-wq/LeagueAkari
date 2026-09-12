import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import type { AkariManager } from '@shared/akari-shard'
import type { SummonerInfo } from '@shared/types/league-client/summoner'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { NButton, NTag } from 'naive-ui'
import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'

import ReviewStudioModal from './ReviewStudioModal.vue'
import { addReviewEvent, createReviewFixture, reviewDragon, reviewKill } from './test-fixtures'

// Synthetic fixtures only. All history and note IO stays in this story's memory.
function fixtures(partial: boolean) {
  return Array.from({ length: 18 }, (_, index) => {
    const fixture = createReviewFixture({ gameId: 90_000 + index, win: index % 3 === 0 })
    fixture.summary.json.gameCreation = Date.UTC(2026, 8, 12, 12) - index * 3_600_000
    const championIds = [238, 122, 64, 51, 412, index % 2 ? 7 : 103, 114, 245, 222, 117]
    fixture.summary.json.participants.forEach((participant, i) => {
      participant.championId = championIds[i]
    })
    for (const frame of fixture.details.json.frames) {
      const minute = frame.timestamp / 60_000
      for (const player of Object.values(frame.participantFrames)) {
        const lane = player.participantId % 3
        player.position = {
          x: 2000 + ((minute * 235 + player.participantId * 730) % 10000),
          y: 2500 + ((minute * 340 + lane * 3100) % 9500)
        }
        if (player.participantId === 3 && minute >= 16)
          player.totalGold += Math.min(minute - 15, 5) * 410
      }
    }
    addReviewEvent(fixture.details, reviewKill(1_031_000, 8, 450))
    addReviewEvent(fixture.details, reviewDragon(1_080_000))
    addReviewEvent(fixture.details, reviewKill(1_177_000, 8))
    fixture.summary.json.participants.find((p) => p.participantId === 8)!.deaths = 2
    if (partial) {
      fixture.details.json.frames = fixture.details.json.frames.filter(
        (frame) => ![600_000, 660_000, 900_000].includes(frame.timestamp)
      )
      fixture.summary.json.participants.find((p) => p.participantId === 8)!.deaths = 3
    }
    return fixture
  })
}

const meta = {
  title: 'Renderer Shared/Review Studio',
  component: ReviewStudioModal,
  parameters: { akariStoryPanelMaxWidth: 1180 },
  args: { show: true, puuid: 'player-8', sgpServerId: 'REVIEW_STORY', initialGameId: 90_000 },
  render: (args, context) => ({
    components: { ReviewStudioModal, NButton, NTag },
    setup() {
      const games =
        context.name === 'Empty History' ? [] : fixtures(context.name === 'Missing Data')
      const appContext = getCurrentInstance()!.appContext
      const previousManager = appContext.config.globalProperties.$akariManager
      const storage = new Map<string, unknown>()
      const storedSettings = {
        get: async (namespace: string, key: string) => storage.get(`${namespace}:${key}`) ?? null,
        set: async (namespace: string, key: string, value: unknown) => {
          storage.set(`${namespace}:${key}`, structuredClone(value))
        }
      }
      const wait = async () => new Promise((resolve) => setTimeout(resolve, 180))
      const query = {
        getMatchHistorySummaryByPlayerPuuid: async () => {
          await wait()
          return { data: { games: games.map((game) => game.summary) } }
        },
        getGameSummaryByGameId: async (id: number) => {
          await wait()
          return { data: games.find((game) => game.summary.json.gameId === id)!.summary }
        },
        getGameDetailsByGameId: async (id: number) => {
          await wait()
          return { data: games.find((game) => game.summary.json.gameId === id)!.details }
        }
      }
      appContext.config.globalProperties.$akariManager = {
        getInstance: (constructor: unknown) => {
          if (constructor === SettingUtilsRenderer) return storedSettings
          if (constructor === SgpRenderer) return { api: { matchHistoryQuery: query } }
          throw new Error('Unexpected shard requested by review preview')
        }
      } as AkariManager
      const sgpStore = useSgpStore()
      const lcs = useLeagueClientStore()
      const previousState = {
        sgpServerId: sgpStore.availability.sgpServerId,
        tokenReady: sgpStore.isTokenReady,
        leagueServers: sgpStore.leagueServers,
        summoner: lcs.summoner.me
      }
      sgpStore.availability.sgpServerId = 'REVIEW_STORY'
      sgpStore.isTokenReady = context.name !== 'Disconnected'
      sgpStore.leagueServers = {
        updatedAt: '',
        serverNames: {},
        servers: {
          REVIEW_STORY: { matchHistory: 'https://example.test', common: '', isTencent: true }
        }
      }
      lcs.summoner.me = { puuid: 'preview-owner' } as SummonerInfo
      onBeforeUnmount(() => {
        appContext.config.globalProperties.$akariManager = previousManager
        sgpStore.availability.sgpServerId = previousState.sgpServerId
        sgpStore.isTokenReady = previousState.tokenReady
        sgpStore.leagueServers = previousState.leagueServers
        lcs.summoner.me = previousState.summoner
      })
      const show = ref(true)
      return { args, show }
    },
    template: `<div class="flex items-center gap-3 p-4"><NTag type="warning">演示数据 · 仅验证界面交互</NTag><NButton @click="show = true">打开复盘台</NButton><ReviewStudioModal v-bind="args" v-model:show="show" /></div>`
  })
} satisfies Meta<typeof ReviewStudioModal>

export default meta
type Story = StoryObj<typeof meta>
export const MatchOverview: Story = {}
export const History: Story = { args: { initialGameId: undefined } }
export const MissingData: Story = {}
export const EmptyHistory: Story = { args: { initialGameId: undefined } }
export const Disconnected: Story = { args: { initialGameId: undefined } }
