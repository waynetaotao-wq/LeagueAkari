<template>
  <div class="tips-demo">
    <NSelect v-model:value="scenario" :options="scenarios" aria-label="预览场景" />
    <NButton size="small" @click="gameId += 1">切换对局</NButton>
    <div class="tips-demo-description">{{ description }}</div>
    <div class="tips-demo-card">
      <PlayerInfoCardHeader puuid="enemy" />
      <div class="tips-demo-secondary">模拟战绩区域</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { NButton, NSelect } from 'naive-ui'
import { computed, ref } from 'vue'

import { provideOngoingGamePanel } from '../../../context'
import PlayerInfoCardHeader from '../PlayerInfoCardHeader.vue'
import { createMatchupFixture } from './fixtures'

const props = withDefaults(defineProps<{ initialScenario?: string }>(), {
  initialScenario: 'confirmed'
})
const scenario = ref(props.initialScenario)
const gameId = ref(101)
const scenarios = [
  { label: '已进入加载 · 瑞兹对菲兹', value: 'confirmed' },
  { label: '已进入加载 · 菲兹对瑞兹', value: 'reverse' },
  { label: '选人阶段 · 已齐十人', value: 'champ-select' },
  { label: '进入加载 · 阵容未齐', value: 'loading' },
  { label: '位置尚未齐全', value: 'unknown-position' },
  { label: '对方不是我的对位', value: 'different-lane' },
  { label: '使用劫 · 保留原有 Bz', value: 'zed' },
  { label: '当前组合未收录', value: 'missing' },
  { label: '客户端已断开', value: 'disconnected' },
  { label: '已退出本局', value: 'unavailable' }
]
const description = computed(() => scenarios.find((item) => item.value === scenario.value)?.label)
const game = computed(() => {
  const value = createMatchupFixture(
    scenario.value === 'reverse' ? 105 : scenario.value === 'zed' ? 238 : 13,
    scenario.value === 'reverse' ? 13 : scenario.value === 'missing' ? 516 : 105
  )
  if (scenario.value === 'loading') value.teams['TEAM-200'].pop()
  if (scenario.value === 'unknown-position') delete value.positionAssignments['enemy-support']
  if (scenario.value === 'different-lane') {
    value.positionAssignments.enemy.position = 'TOP'
    value.positionAssignments['enemy-top'].position = 'MIDDLE'
  }
  return {
    ...value,
    isConnected: scenario.value !== 'disconnected',
    queryStage:
      scenario.value === 'unavailable'
        ? { phase: 'unavailable' as const, gameInfo: null }
        : {
            phase:
              scenario.value === 'champ-select' ? ('champ-select' as const) : ('in-game' as const),
            gameInfo: {
              gameId: gameId.value,
              gameMode: 'CLASSIC',
              queueId: 420,
              queueType: 'RANKED_SOLO_5x5'
            }
          }
  }
})

provideOngoingGamePanel({
  ongoingGame: game,
  contentWidth: 230,
  contentHeight: 300,
  columnsNeed: 1,
  linesPerTeam: 1,
  isTwoTeamsMode: true,
  mergedPremadeTeams: { groups: {}, premadeTeamIdMap: {} },
  isStandaloneOngoingGameWindow: false,
  kdaOutliers: {},
  navigateToSummonerByPuuid: () => {},
  previewGame: () => {}
})
</script>

<style scoped>
.tips-demo {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 16px;
  max-width: 420px;
  min-height: 360px;
}
.tips-demo-card {
  position: relative;
  box-sizing: border-box;
  width: 230px;
  max-width: 100%;
  min-height: 150px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.2);
  border-radius: 6px;
  padding: 8px;
  background: var(--la-card-surface-90);
}
.tips-demo-secondary,
.tips-demo-description {
  color: color-mix(in oklch, var(--la-color-text-primary) 65%, transparent);
  font-size: 12px;
}
</style>
