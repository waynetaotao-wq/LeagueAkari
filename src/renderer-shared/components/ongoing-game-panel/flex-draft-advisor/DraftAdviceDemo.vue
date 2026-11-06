<template>
  <div style="padding: 12px">
    <div style="display: flex; gap: 12px; align-items: center; margin: 0 16px 12px">
      <NSelect
        v-model:value="scenario"
        :options="scenarios"
        style="width: 240px"
        aria-label="预览场景"
      />
      <span>模拟数据，仅用于布局和交互验证</span>
    </div>
    <DraftAdviceView
      v-if="context && target"
      v-model:selected-role="selectedRole"
      v-model:selected-opponent="selectedOpponent"
      v-model:comfortable="comfortable"
      :context="context"
      :target="target"
      :role="role"
      :histories="histories"
      :bans="bans"
      :picks="picks"
      :champion-names="championNames"
      :pickable-ids="[13, 103, 238]"
      :player-names="playerNames"
      :loading="false"
      :history-loading="false"
      :history-statuses="historyStatuses"
      :history-scans="historyScans"
      :failed="scenario === 'partial'"
      patch="16.18"
      :loaded-players="context.enemies.filter((p) => histories[p.puuid]?.games > 0).length"
    />
    <div v-else style="padding: 16px">该模式不显示选人助手</div>
  </div>
</template>

<script setup lang="ts">
import { NSelect } from 'naive-ui'
import { computed, ref, watch } from 'vue'

import DraftAdviceView from './DraftAdviceView.vue'
import { createDraftFixture, historyFixture } from './fixtures'
import {
  buildTargetPool,
  getDraftContext,
  pickCandidates,
  rankBans,
  rankPicks,
  readPlayerHistory,
  type DraftRole,
  type MatchupSample
} from './model'

const props = withDefaults(defineProps<{ initialScenario?: string }>(), {
  initialScenario: 'normal'
})
const scenario = ref(props.initialScenario)
const selectedRole = ref<DraftRole | null>(null)
const selectedOpponent = ref<string | null>(null)
const comfortable = ref<number[] | null>(null)
watch(
  scenario,
  (value) => {
    if (value === 'clashLockedPool') comfortable.value = [13, 103]
  },
  { immediate: true }
)
const scenarios = [
  { label: 'Clash · 正常分析', value: 'clash' },
  { label: 'Clash · 缺少历史', value: 'clashEmpty' },
  { label: 'Clash · 本轮剩一次禁用', value: 'clashOneBan' },
  { label: 'Clash · 等待第二轮禁用', value: 'clashWaiting' },
  { label: 'Clash · 第二轮两次禁用', value: 'clashSecondBan' },
  { label: 'Clash · 我方禁用完成', value: 'clashOwnFinished' },
  { label: 'Clash · 锁定后保留旧手动池', value: 'clashLockedPool' },
  { label: '五排 · 正常分析', value: 'normal' },
  { label: '五排 · 阵容缺口', value: 'composition' },
  { label: '五排 · 战绩读取状态', value: 'historyStates' },
  { label: '五排 · 仅我方读取失败', value: 'allyHistoryError' },
  { label: '五排 · 对手已锁定', value: 'locked' },
  { label: '五排 · 推测对位', value: 'inferred' },
  { label: '五排 · 部分统计缺失', value: 'partial' },
  { label: '五排 · 候选全不利', value: 'unfavorable' },
  { label: '五排 · 我方已锁冷门英雄', value: 'selfLocked' },
  { label: '五排 · 缺少历史', value: 'empty' },
  { label: '单排 · 不显示', value: 'solo' },
  { label: '大乱斗 Clash · 不显示', value: 'aramClash' }
]
const fixture = computed(() => {
  const { game, session } = createDraftFixture(scenario.value.startsWith('clash') ? 700 : 710)
  const completed = {
    clashOneBan: 4,
    clashWaiting: 6,
    clashSecondBan: 12,
    clashOwnFinished: 15,
    clashLockedPool: 12
  }[scenario.value]
  if (completed !== undefined) {
    const lockedChampions: Record<number, number> = { 0: 61, 1: 238, 2: 13, 5: 24, 6: 64, 7: 105 }
    const bannedChampions = [1, 2, 3, 4, 5, 6, 8, 9, 10, 11]
    let banIndex = 0
    session.actions.flat().forEach((action, index) => {
      if (scenario.value === 'clashOwnFinished') {
        // Red-side draft order: our final ban precedes the opposing team's final ban.
        action.actorCellId = (action.actorCellId + 5) % 10
        action.isAllyAction = !action.isAllyAction
      }
      action.completed = index < completed
      action.isInProgress = index === completed
      if (!action.completed) return
      if (action.type === 'ban') action.championId = bannedChampions[banIndex++]
      else {
        action.championId = lockedChampions[action.actorCellId]
        const member = [...session.myTeam, ...session.theirTeam].find(
          (p) => p.cellId === action.actorCellId
        )!
        member.championId = action.championId
      }
    })
    if (scenario.value === 'clashLockedPool') session.myTeam[2].championPickIntent = 103
  }
  if (scenario.value === 'solo' && game.queryStage.phase === 'champ-select')
    game.queryStage.gameInfo.queueId = 420
  if (scenario.value === 'aramClash' && game.queryStage.phase === 'champ-select') {
    game.queryStage.gameInfo.queueId = 720
    game.queryStage.gameInfo.gameMode = 'ARAM'
    session.queueId = 720
  }
  if (scenario.value === 'inferred') session.theirTeam.forEach((p) => (p.assignedPosition = ''))
  if (scenario.value === 'composition') {
    for (const [cellId, championId] of [
      [0, 103],
      [1, 202]
    ]) {
      session.myTeam[cellId].championId = championId
      session.actions.push([
        {
          actorCellId: cellId,
          championId,
          completed: true,
          id: 30 + cellId,
          isAllyAction: true,
          isInProgress: false,
          type: 'pick',
          duration: 30_000,
          pickTurn: cellId
        }
      ])
    }
  }
  if (scenario.value === 'locked' || scenario.value === 'selfLocked') {
    const selfLocked = scenario.value === 'selfLocked'
    const member = selfLocked ? session.myTeam[2] : session.theirTeam[2]
    member.championId = selfLocked ? 61 : 105
    session.actions.push([
      {
        actorCellId: member.cellId,
        championId: member.championId,
        completed: true,
        id: 20,
        isAllyAction: selfLocked,
        isInProgress: false,
        type: 'pick',
        duration: 30_000,
        pickTurn: 1
      }
    ])
  }
  return { game, session }
})
const context = computed(() => getDraftContext(fixture.value.game, fixture.value.session))
const historyStatuses = computed<
  Record<string, 'ready' | 'empty' | 'loading' | 'error' | 'waiting' | 'pending'>
>(() =>
  Object.fromEntries(
    [...(context.value?.allies ?? []), ...(context.value?.enemies ?? [])].map((player, i) => [
      player.puuid,
      scenario.value === 'allyHistoryError' && player.cellId < 3
        ? 'error'
        : scenario.value === 'historyStates'
          ? (['ready', 'empty', 'loading', 'error', 'waiting'] as const)[i % 5]
          : scenario.value === 'empty' || scenario.value === 'clashEmpty'
            ? 'empty'
            : 'ready'
    ])
  )
)
const historyScans = computed(() =>
  Object.fromEntries(
    [...(context.value?.allies ?? []), ...(context.value?.enemies ?? [])]
      .filter((player) => historyStatuses.value[player.puuid] !== 'waiting')
      .map((player) => [
        player.puuid,
        { source: 'sgp' as const, scannedCount: histories.value[player.puuid]?.games ?? 0 }
      ])
  )
)
const championNames = {
  13: '瑞兹',
  103: '阿狸',
  238: '劫',
  105: '菲兹',
  7: '乐芙兰',
  517: '塞拉斯',
  24: '贾克斯',
  64: '李青',
  202: '烬',
  111: '诺提勒斯',
  61: '奥莉安娜'
}
const histories = computed(() =>
  Object.fromEntries(
    [...fixture.value.session.myTeam, ...fixture.value.session.theirTeam].map((p) => {
      const ids =
        scenario.value === 'clashLockedPool' && p.cellId === 8
          ? Array(8).fill(103)
          : p.cellId === 2
            ? scenario.value === 'composition'
              ? [13, 13, 111, 111, 238, 238]
              : [13, 13, 13, 13, 103, 103, 103, 238, 238]
            : p.cellId === 7
              ? [105, 105, 105, 105, 105, 7, 7, 517]
              : Array(8).fill([24, 64, 105, 202, 111][p.cellId % 5])
      return [
        p.puuid,
        readPlayerHistory(
          p.puuid,
          scenario.value === 'empty' ||
            scenario.value === 'clashEmpty' ||
            (scenario.value === 'allyHistoryError' && p.cellId < 3) ||
            (scenario.value === 'historyStates' && [6, 9].includes(p.cellId))
            ? []
            : historyFixture(
                p.puuid,
                ids,
                ['top', 'jungle', 'middle', 'bottom', 'utility'][p.cellId % 5] as DraftRole,
                Date.now(),
                context.value?.queueId ?? 710
              ),
          Date.now(),
          context.value?.queueId ?? 710
        )
      ]
    })
  )
)
const role = computed(() => selectedRole.value ?? 'middle')
const target = computed(() =>
  context.value
    ? buildTargetPool(context.value, histories.value, role.value, selectedOpponent.value)
    : null
)
const available = new Set(Object.keys(championNames).map(Number))
const rankingOptions = computed(() => ({
  context: context.value ?? undefined,
  selfRole: role.value,
  championRoles: {
    13: ['mage'],
    103: ['mage', 'assassin'],
    238: ['assassin'],
    111: ['tank', 'support'],
    202: ['marksman']
  }
}))
const candidates = computed(() =>
  context.value
    ? pickCandidates(
        context.value,
        histories.value['player-2'],
        role.value,
        comfortable.value,
        available,
        new Set()
      )
    : []
)
const samples: Record<number, MatchupSample[]> = {
  111: [
    { championId: 105, games: 1200, wins: 648 },
    { championId: 7, games: 900, wins: 450 },
    { championId: 517, games: 1500, wins: 825 }
  ],
  13: [
    { championId: 105, games: 1200, wins: 648 },
    { championId: 7, games: 900, wins: 450 },
    { championId: 517, games: 1500, wins: 825 }
  ],
  103: [
    { championId: 105, games: 1400, wins: 672 },
    { championId: 7, games: 1600, wins: 800 },
    { championId: 517, games: 1800, wins: 918 }
  ],
  238: [
    { championId: 105, games: 2000, wins: 940 },
    { championId: 7, games: 1800, wins: 810 },
    { championId: 517, games: 1000, wins: 480 }
  ]
}
const picks = computed(() =>
  target.value
    ? rankPicks(
        candidates.value,
        target.value,
        scenario.value === 'partial'
          ? { 13: samples[13] }
          : scenario.value === 'unfavorable'
            ? Object.fromEntries(Object.keys(samples).map((id) => [id, samples[238]]))
            : samples,
        rankingOptions.value
      )
    : []
)
const bans = computed(() =>
  context.value
    ? rankBans(
        context.value,
        histories.value,
        available,
        new Set(),
        context.value.self.lockedChampionId
          ? [context.value.self.lockedChampionId]
          : [
              context.value.self.hoverChampionId,
              ...(comfortable.value ?? candidates.value.map((p) => p.championId))
            ],
        rankingOptions.value
      )
    : []
)
const playerNames = computed(() =>
  Object.fromEntries(
    [...(context.value?.allies ?? []), ...(context.value?.enemies ?? [])].map((p) => [
      p.puuid,
      p.name
    ])
  )
)
</script>
