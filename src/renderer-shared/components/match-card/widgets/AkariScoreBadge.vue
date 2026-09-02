<template>
  <NPopover v-if="score" :delay="300" placement="top">
    <template #trigger>
      <div
        class="flex items-center select-none"
        :class="size === 'md' ? 'flex-col justify-center gap-0.5' : 'gap-1'"
      >
        <div
          class="font-bold tabular-nums"
          :class="[size === 'md' ? 'text-base leading-5' : 'text-[11px] leading-4', ratingClass]"
        >
          {{ score.rating.toFixed(1) }}
          <span
            v-if="size === 'md'"
            class="text-[11px] font-normal text-black/60 dark:text-white/60"
            >评分</span
          >
        </div>
        <span
          v-if="tag"
          class="rounded px-1 text-[10px] leading-4 font-bold"
          :class="tag.class"
          >{{ tag.text }}</span
        >
      </div>
    </template>
    <div class="w-44 text-xs">
      <div class="mb-1 flex items-baseline justify-between">
        <span class="font-bold">对局评分 {{ score.rating.toFixed(1) }}</span>
        <span class="text-[10px] text-black/60 dark:text-white/60">
          {{ positionText }}{{ tag ? ` · ${tag.text}` : '' }}
        </span>
      </div>
      <div v-for="row of breakdown" :key="row.key" class="flex items-center gap-2 py-px">
        <span class="w-7 shrink-0 text-black/70 dark:text-white/70">{{ row.label }}</span>
        <div class="h-1.5 flex-1 overflow-hidden rounded bg-black/10 dark:bg-white/10">
          <div
            class="h-full rounded"
            :class="row.ratio >= 1 ? 'bg-emerald-500/80' : 'bg-red-500/70'"
            :style="{ width: `${Math.min(100, (row.ratio / 2) * 100).toFixed(0)}%` }"
          />
        </div>
        <span class="w-9 shrink-0 text-right tabular-nums text-black/70 dark:text-white/70">
          {{ row.ratio.toFixed(2) }}×
        </span>
      </div>
      <div v-if="score.afkTeammate" class="mt-1 text-[10px] text-amber-700 dark:text-amber-300">
        本局有队友挂机，分数仅供参考
      </div>
      <div class="mt-1 text-[10px] leading-4 text-black/50 dark:text-white/45">
        各项为相对本局期望的倍数（1.00× = 本局平均）；按分路加权，只在本局 10 人内比较。
        与总览侧栏的 "Akari Score"（官方绝对量表）不是同一指标。
      </div>
    </div>
  </NPopover>
</template>

<script setup lang="ts">
import { NPopover } from 'naive-ui'
import { computed } from 'vue'

import { AKARI_METRIC_LABELS, type AkariMetricKey, type AkariScore } from '../utils/akari-score'

const props = withDefaults(
  defineProps<{
    score: AkariScore | null | undefined
    size?: 'sm' | 'md'
  }>(),
  { size: 'sm' }
)

const POSITION_TEXT: Record<AkariScore['position'], string> = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助',
  UNKNOWN: '通用权重'
}

const ratingClass = computed(() => {
  const r = props.score?.rating ?? 0
  if (r >= 8) return 'text-amber-600 dark:text-amber-300'
  if (r >= 6) return 'text-emerald-600 dark:text-emerald-300'
  if (r >= 4) return 'text-black dark:text-white'
  return 'text-red-600 dark:text-red-300'
})

const tag = computed(() => {
  const s = props.score
  if (!s) return null
  if (s.isMvp) {
    return { text: 'MVP', class: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' }
  }
  if (s.isSvp) {
    return { text: 'SVP', class: 'bg-sky-500/20 text-sky-700 dark:text-sky-300' }
  }
  if (s.isCarryLoss) {
    return { text: '尽力局', class: 'bg-violet-500/20 text-violet-700 dark:text-violet-300' }
  }
  return null
})

const positionText = computed(() => (props.score ? POSITION_TEXT[props.score.position] : ''))

const breakdown = computed(() => {
  const s = props.score
  if (!s) return []
  return (Object.keys(AKARI_METRIC_LABELS) as AkariMetricKey[])
    .filter((key) => typeof s.metrics[key] === 'number')
    .map((key) => ({ key, label: AKARI_METRIC_LABELS[key], ratio: s.metrics[key] as number }))
})
</script>
