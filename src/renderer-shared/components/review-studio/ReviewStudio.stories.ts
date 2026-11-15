import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import type { AkariManager } from '@shared/akari-shard'
import type { Item } from '@shared/types/league-client/game-data'
import type { SummonerInfo } from '@shared/types/league-client/summoner'
import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { NButton, NTag } from 'naive-ui'
import { getCurrentInstance, onBeforeUnmount, ref } from 'vue'

import ReviewStudioModal from './ReviewStudioModal.vue'
import {
  addReviewEvent,
  createReviewFixture,
  reviewDragon,
  reviewKill,
  reviewPlate,
  reviewPurchase,
  reviewWard
} from './test-fixtures'

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

const STORY_ITEMS = Object.fromEntries(
  [
    { id: 1055, priceTotal: 450, from: [] as number[], categories: ['Damage'] },
    { id: 1036, priceTotal: 350, from: [] as number[], categories: ['Damage'] },
    { id: 3158, priceTotal: 900, from: [1001], categories: ['Boots'] },
    { id: 6699, priceTotal: 3000, from: [1036, 1036], categories: ['Damage'] }
  ].map((item) => [item.id, item as unknown as Item])
)

/**
 * Thirty synthetic games with deaths, purchases, wards and plates, so the cross-game views have
 * something to show. Lost games die earlier and more often around the bottom river and finish
 * their first item later — an invented pattern for checking the interface, not real play.
 */
function patternFixtures() {
  let seed = 20261114
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 2 ** 32
  }
  const between = (low: number, high: number) => low + random() * (high - low)
  const near = (x: number, y: number, spread = 700) => ({
    x: Math.round(x + between(-spread, spread)),
    y: Math.round(y + between(-spread, spread))
  })
  return Array.from({ length: 30 }, (_, index) => {
    const win = index % 15 < 8
    const fixture = createReviewFixture({ gameId: 70_000 + index, win, duration: 1680 })
    const { summary, details } = fixture
    summary.json.gameCreation = Date.UTC(2026, 10, 12, 20) - index * 5_400_000
    summary.json.gameVersion = '16.22.1'
    const championIds = [238, 122, 64, 51, 412, [103, 61, 7, 245][index % 4], 114, 59, 222, 117]
    summary.json.participants.forEach((participant, i) => {
      participant.championId = championIds[i]
      // Every third game is played from the red side.
      if (index % 3 === 2) participant.teamId = participant.teamId === 100 ? 200 : 100
    })
    const csPerMinute = win ? between(7.6, 8.8) : between(6.4, 7.8)
    const goldPerMinute = win ? between(360, 420) : between(250, 330)
    for (const frame of details.json.frames) {
      const minute = frame.timestamp / 60_000
      const own = frame.participantFrames['8']
      own.minionsKilled = Math.round(minute * csPerMinute)
      own.totalGold = Math.round(500 + minute * goldPerMinute)
    }
    const roam = Math.floor(between(5, 11))
    if (random() < (win ? 0.75 : 0.4)) {
      details.json.frames[roam].participantFrames['8'].position = near(9000, 1600, 300)
      details.json.frames[roam + 1].participantFrames['8'].position = near(10200, 1500, 300)
    }
    const spots = win
      ? [near(7500, 7500), near(8800, 8400), near(5000, 10400), near(9800, 4500)]
      : [near(9800, 4500, 500), near(9600, 4900, 500), near(7600, 7300), near(10300, 5200, 500)]
    const deaths = Math.round(win ? between(2, 5) : between(5, 8))
    for (let n = 0; n < deaths; n++) {
      const early = n < (win ? 1 : 3)
      const ganked = random() < (win ? 0.3 : 0.55)
      addReviewEvent(details, {
        type: 'CHAMPION_KILL',
        timestamp: Math.round(early ? between(280_000, 760_000) : between(800_000, 1_600_000)),
        killerId: ganked ? 9 : 3,
        victimId: 8,
        assistingParticipantIds: ganked ? [3] : random() < 0.25 ? [7] : [],
        position: early
          ? spots[n % spots.length]
          : near(between(3500, 11500), between(3500, 11500)),
        bounty: 300,
        shutdownBounty: 0,
        killStreakLength: 0,
        victimDamageReceived: []
      })
    }
    summary.json.participants.find((participant) => participant.participantId === 8)!.deaths =
      deaths
    for (const event of [
      reviewPurchase(6_000, 1055),
      reviewPurchase(Math.round(win ? between(230_000, 330_000) : between(170_000, 260_000)), 1036),
      reviewPurchase(Math.round(win ? between(540_000, 660_000) : between(680_000, 840_000)), 6699),
      reviewPurchase(900_000, 3158),
      ...Array.from({ length: Math.round(between(2, 5)) }, () =>
        reviewWard(Math.round(between(90_000, 590_000)))
      ),
      ...Array.from({ length: Math.round(win ? between(2, 5) : between(0, 2)) }, () =>
        reviewPlate(Math.round(between(240_000, 820_000)), index % 3 === 2 ? 100 : 200)
      ),
      ...Array.from({ length: Math.round(win ? between(0, 2) : between(1, 4)) }, () =>
        reviewPlate(Math.round(between(240_000, 820_000)), index % 3 === 2 ? 200 : 100)
      )
    ])
      addReviewEvent(details, event)
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
        context.name === 'Empty History'
          ? []
          : context.name === 'Death Map' || context.name === 'Outcome Gap'
            ? patternFixtures()
            : fixtures(context.name === 'Missing Data')
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
        summoner: lcs.summoner.me,
        items: lcs.gameData.items
      }
      lcs.gameData.items = STORY_ITEMS
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
        lcs.gameData.items = previousState.items
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
export const DeathMap: Story = { args: { initialGameId: undefined, initialTab: 'deaths' } }
export const OutcomeGap: Story = { args: { initialGameId: undefined, initialTab: 'gap' } }
