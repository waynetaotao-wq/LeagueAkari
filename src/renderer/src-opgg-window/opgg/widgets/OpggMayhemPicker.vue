<template>
  <div
    v-if="visible"
    class="mb-1 rounded border border-black/10 p-2 last:mb-0 dark:border-[#37373c]"
  >
    <div class="mb-2 flex items-center justify-between text-[13px] font-bold">
      <span>大乱斗帮我选</span>
      <span class="text-xs font-normal text-[#666666] dark:text-[#bebebe]">
        换谁队伍胜率最高（Mayhem 专属数据）
      </span>
    </div>

    <div
      v-for="(a, i) of advices"
      :key="a.championId"
      class="mb-1 flex items-center gap-2 last:mb-0"
    >
      <span class="min-w-4 text-[10px] text-[#666666] dark:text-[#b2b2b2]">#{{ i + 1 }}</span>
      <ChampionIcon round class="size-6 shrink-0" :champion-id="a.championId" />
      <span class="min-w-0 flex-1 truncate text-xs">
        {{ championName(a.championId) }}
      </span>
      <span
        v-if="a.masteryAdj > 0"
        class="shrink-0 text-[10px] text-[#2a947d] dark:text-[#5fd3a5]"
        :title="`你的熟练度修正 +${(a.masteryAdj * 100).toFixed(1)}%`"
      >
        熟
      </span>
      <span
        v-else-if="a.masteryAdj < 0"
        class="shrink-0 text-[10px] text-[#666666] dark:text-[#b2b2b2]"
        :title="`不熟悉修正 ${(a.masteryAdj * 100).toFixed(1)}%`"
      >
        生
      </span>
      <span
        v-if="a.synergyHits.length"
        class="flex shrink-0 items-center gap-0.5"
        :title="synergyTitle(a)"
      >
        <span class="text-[10px] text-[#2a947d] dark:text-[#5fd3a5]">协同</span>
        <ChampionIcon
          v-for="wid of a.synergyHits[0].withIds.slice(0, 2)"
          :key="wid"
          round
          class="size-4"
          :champion-id="wid"
        />
      </span>
      <span
        class="w-24 shrink-0 text-right text-xs font-bold tabular-nums"
        :class="
          a.teamWinRate >= 0.5
            ? 'text-[#2a947d] dark:text-[#5fd3a5]'
            : 'text-[#dc2626] dark:text-[#d75a5a]'
        "
        :title="`该英雄本模式胜率 ${a.baseWinRate === null ? '无数据' : (a.baseWinRate * 100).toFixed(1) + '%'}`"
      >
        队伍 {{ (a.teamWinRate * 100).toFixed(1) }}%
        <span
          v-if="a.championId !== currentChampionId"
          class="font-normal"
          :class="
            teamDelta(a) >= 0
              ? 'text-[#2a947d] dark:text-[#5fd3a5]'
              : 'text-[#dc2626] dark:text-[#d75a5a]'
          "
        >
          ({{ teamDelta(a) >= 0 ? '+' : '' }}{{ (teamDelta(a) * 100).toFixed(1) }})
        </span>
      </span>
      <NButton
        v-if="a.championId !== currentChampionId"
        size="tiny"
        type="primary"
        secondary
        class="h-4.5! w-9! min-w-0 px-0!"
        :disabled="swapping"
        @click="handleSwap(a.championId)"
      >
        换TA
      </NButton>
      <span v-else class="w-9 shrink-0 text-center text-[10px] text-[#666666] dark:text-[#b2b2b2]">
        手持
      </span>
    </div>

    <!-- 手持英雄的最佳海克斯增益（局内选增益时照着拿） -->
    <div
      v-if="bestAugments.length"
      class="mt-1.5 flex items-center gap-1.5 border-t border-black/5 pt-1.5 dark:border-white/8"
    >
      <span class="shrink-0 text-[10px] text-[#666666] dark:text-[#b2b2b2]">
        {{ championName(currentChampionId) }} 增益推荐
      </span>
      <AugmentDisplay
        v-for="ag of bestAugments"
        :key="ag.augmentId"
        :augment-id="ag.augmentId"
        :size="24"
      />
    </div>

    <div class="mt-1 text-[10px] text-[#666666]/80 dark:text-[#b2b2b2]/70">
      队伍胜率 = 五人本模式胜率均值 + 协同净增量 + 你的熟练度修正（括号为较当前手持的增减；"熟/生"为个人修正标记）；点"换TA"直接换取
    </div>
  </div>
</template>

<script setup lang="ts">
import AugmentDisplay from '@renderer-shared/components/widgets/AugmentDisplay.vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useInstance } from '@renderer-shared/shards'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { NButton } from 'naive-ui'
import { computed, ref } from 'vue'

import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { onMounted, shallowRef } from 'vue'

import { useOpgg } from '../context'
import { type MayhemPickAdvice, scoreMayhemPicks } from '../utils/mayhem-picker'

const lcs = useLeagueClientStore()
const lc = useInstance(LeagueClientRenderer)
const ipc = useInstance(AkariIpcRenderer)

/** 本人熟练度表（championId → 点数）；拉取失败保持空表=零修正 */
const masteries = shallowRef<Record<number, number>>({})
onMounted(async () => {
  try {
    const got = await ipc.call('window-manager-main/draftgap-window', 'getMasteries')
    if (got && typeof got === 'object') masteries.value = got as Record<number, number>
  } catch {}
})
const resources = useAkariResourceProvider()
const { overview } = useOpgg()

const sections = computed(() => (overview.value as any)?.sections ?? null)

/** 数据驱动显示：只有 Mayhem 数据面（含协同/增益区）+ 处于选人 + 有板凳可换时出现 */
const currentChampionId = computed(() => lcs.champSelect.currentChampion ?? 0)

const benchIds = computed(() => {
  const bench = (lcs.champSelect.session as any)?.benchChampions ?? []
  return bench
    .map((b: any) => (typeof b === 'number' ? b : b?.championId))
    .filter((x: any) => typeof x === 'number' && x > 0) as number[]
})

const teammates = computed(() => {
  const my = (lcs.champSelect.session as any)?.myTeam ?? []
  const self = currentChampionId.value
  return my
    .map((m: any) => m?.championId)
    .filter((x: any) => typeof x === 'number' && x > 0 && x !== self) as number[]
})

const isMayhemData = computed(() => {
  const s = sections.value
  return !!s && (Array.isArray(s.synergies) ? s.synergies.length > 0 : false)
})

const advices = computed<MayhemPickAdvice[]>(() => {
  const s = sections.value
  if (!s) return []
  const candidates = [currentChampionId.value, ...benchIds.value]
  return scoreMayhemPicks(candidates, teammates.value, s.champions ?? [], s.synergies ?? [], {
    masteryPointsOf: (id) => masteries.value[id] ?? null
  }).sort((a, b) => b.teamWinRate - a.teamWinRate)
})

const currentTeamWinRate = computed(
  () => advices.value.find((a) => a.championId === currentChampionId.value)?.teamWinRate ?? null
)

function teamDelta(a: MayhemPickAdvice) {
  return a.teamWinRate - (currentTeamWinRate.value ?? a.teamWinRate)
}

const visible = computed(
  () =>
    isMayhemData.value &&
    lcs.gameflow.phase === 'ChampSelect' &&
    currentChampionId.value > 0 &&
    benchIds.value.length > 0 &&
    advices.value.length > 0
)

const swapping = ref(false)

async function handleSwap(championId: number) {
  if (swapping.value) return
  swapping.value = true
  try {
    await lc.api.champSelect.benchSwap(championId)
  } catch {
    // 换取失败（可能已被队友拿走 / 阶段不允许），保持静默由界面状态自证
  } finally {
    swapping.value = false
  }
}

/** 手持英雄的最佳增益（增益表 bestChampionIds 反查，按榜单序取前 3） */
const bestAugments = computed(() => {
  const s2 = sections.value
  const cur = currentChampionId.value
  if (!s2 || !Array.isArray(s2.augments) || cur <= 0) return []
  return s2.augments
    .filter(
      (ag: any) => Array.isArray(ag?.bestChampionIds) && ag.bestChampionIds.includes(cur)
    )
    .sort(
      (a: any, b: any) =>
        (a.rank ?? Number.POSITIVE_INFINITY) - (b.rank ?? Number.POSITIVE_INFINITY)
    )
    .slice(0, 3)
})

function championName(id: number) {
  return resources.champions.name(id) || String(id)
}

function synergyTitle(a: MayhemPickAdvice) {
  return a.synergyHits
    .map(
      (h) =>
        `与 ${h.withIds.map(championName).join('+')} 组合胜率 ${(h.winRate * 100).toFixed(1)}%`
    )
    .join('；')
}
</script>

<style scoped></style>
