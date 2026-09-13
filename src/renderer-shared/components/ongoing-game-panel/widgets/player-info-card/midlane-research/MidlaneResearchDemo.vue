<template>
  <div class="research-demo">
    <NSelect v-model:value="scenario" :options="scenarios" aria-label="中单研究预览场景" />
    <div class="text-xs text-black/60 dark:text-white/60">
      合成数据预览；悬停头像或研究条。头像点击次数：{{ navigations }}
    </div>
    <NButton size="small" @click="generation++">切换玩家</NButton>
    <div class="research-demo-card" :class="{ 'research-demo-edge': edge }">
      <PlayerInfoCardHeader puuid="enemy" />
      <MidlaneResearchBar />
      <div class="py-2 text-xs text-black/50 dark:text-white/50">模拟战绩区域</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NButton, NSelect } from 'naive-ui'
import { computed, reactive, ref, watchEffect } from 'vue'

import { provideOngoingGamePanel } from '../../../context'
import { createMatchupFixture } from '../matchup-tips/fixtures'
import PlayerInfoCardHeader from '../PlayerInfoCardHeader.vue'
import { emptyDeepResult } from './analysis'
import { type MidResearchState, provideMidlaneResearch } from './context'
import MidlaneResearchBar from './MidlaneResearchBar.vue'

const { initialScenario = 'roam', edge = false } = defineProps<{
  initialScenario?: string
  edge?: boolean
}>()
const scenario = ref(initialScenario)
const generation = ref(1)
const navigations = ref(0)
const scenarios = [
  { label: '游走偏下 · 多条重点', value: 'roam' },
  { label: '前期单杀记录较多', value: 'solo' },
  { label: '10 分钟经济常领先', value: 'lane' },
  { label: '样本少 · 不给定性提醒', value: 'small' },
  { label: '缺失较多 · 不给定性提醒', value: 'failures' },
  { label: '没有突出倾向', value: 'neutral' },
  { label: '正在自动分析', value: 'loading' },
  { label: '渐进结果 · 仍在分析', value: 'partial' },
  { label: '获取失败 · 可重试', value: 'error' },
  { label: '没有符合条件的战绩', value: 'empty' },
  { label: '非中单 · 不显示研究', value: 'hidden' },
  { label: '己方中单 · 只看历史表现', value: 'ally' }
]
const game = computed(() => {
  const value = createMatchupFixture()
  if (scenario.value === 'hidden') value.positionAssignments.enemy.position = 'TOP'
  return value
})
provideOngoingGamePanel({
  ongoingGame: game,
  contentWidth: 240,
  contentHeight: 300,
  columnsNeed: 1,
  linesPerTeam: 1,
  isTwoTeamsMode: true,
  mergedPremadeTeams: { groups: {}, premadeTeamIdMap: {} },
  isStandaloneOngoingGameWindow: false,
  kdaOutliers: {},
  navigateToSummonerByPuuid: () => {
    navigations.value++
  },
  previewGame: () => {}
})
const state = reactive<MidResearchState>({
  phase: 'idle',
  progressDone: 0,
  progressTotal: 60,
  result: null
})
watchEffect(() => {
  generation.value
  const selected = scenario.value
  const deep = { ...emptyDeepResult(), deepGames: 20, attemptedGames: 20 }
  if (['roam', 'partial', 'failures', 'ally'].includes(selected)) {
    Object.assign(deep, {
      roamGames: 14,
      roamDirs: { top: 4, bot: 10, invade: 0 },
      roamEpisodes: 20,
      roamEpisodeDirs: { top: 6, bot: 14 },
      roamFirstTimesMs: Array(14).fill(6 * 60000),
      roamSuccess: 8,
      firstKillGames: 12,
      firstKillBuckets: [0, 0, 8, 4, 0],
      soloKills: 15,
      laneDiffGames: 20,
      goldLead10Games: 15,
      goldDiff10Sum: 9000,
      csDiff10Sum: 200,
      zoneFrames: { top: 20, mid: 190, bot: 50 },
      minutePositions: [
        { x: 7400, y: 7400, lane: 'mid' },
        { x: 12000, y: 2500, lane: 'bot' }
      ],
      killPoints: [{ x: 11800, y: 2600, lane: 'bot' }],
      earlyTakedowns: 60,
      earlyTeamKills: 130
    })
  }
  if (selected === 'solo')
    Object.assign(deep, { firstKillGames: 10, firstKillBuckets: [1, 6, 2, 1, 0] })
  if (selected === 'lane')
    Object.assign(deep, { laneDiffGames: 20, goldLead10Games: 14, goldDiff10Sum: 8000 })
  if (selected === 'small')
    Object.assign(deep, {
      deepGames: 3,
      attemptedGames: 3,
      roamGames: 2,
      roamDirs: { top: 0, bot: 2, invade: 0 },
      roamEpisodes: 2,
      roamEpisodeDirs: { top: 0, bot: 2 },
      roamFirstTimesMs: [360000, 420000],
      firstKillGames: 1,
      firstKillBuckets: [0, 0, 1, 0, 0],
      soloKills: 1
    })
  if (selected === 'failures') Object.assign(deep, { attemptedGames: 30, timelineFailures: 10 })
  state.phase =
    selected === 'error'
      ? 'error'
      : selected === 'loading'
        ? 'list'
        : selected === 'partial'
          ? 'deep'
          : 'done'
  state.progressDone = 20
  state.result =
    selected === 'loading' || selected === 'error'
      ? null
      : {
          ladder: {
            games: Array.from(
              { length: selected === 'empty' ? 0 : deep.attemptedGames },
              (_, i) => ({
                gameId: i + 1,
                gameCreation: 1789257600000 - i * 3600000,
                gameVersion: '16.18',
                gameDuration: 1800,
                selfPid: 3,
                teamId: 100,
                participantTeams: { 3: 100 },
                win: i % 2 === 0
              })
            ),
            slices:
              selected === 'empty'
                ? []
                : [
                    {
                      version: '16.18',
                      games: deep.attemptedGames,
                      wins: Math.ceil(deep.attemptedGames / 2)
                    }
                  ],
            truncated: false
          },
          deep: selected === 'empty' ? emptyDeepResult() : deep
        }
})
provideMidlaneResearch({
  state,
  visible: computed(() => scenario.value !== 'hidden'),
  championId: computed(() => 105),
  isOpponent: computed(() => scenario.value !== 'ally'),
  identity: computed(() => `${generation.value}:${scenario.value}`),
  retry: async () => {
    scenario.value = 'roam'
  }
})
</script>

<style scoped>
.research-demo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  max-width: 420px;
  min-height: 450px;
}
.research-demo-card {
  box-sizing: border-box;
  width: 240px;
  max-width: 100%;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.2);
  border-radius: 6px;
  padding: 8px;
  background: var(--la-card-surface-90);
}
.research-demo-edge {
  position: fixed;
  right: 24px;
  bottom: 24px;
}
</style>
