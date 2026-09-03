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
          {{ formatAkariRating(score.rating) }}
          <span
            v-if="size === 'md'"
            class="text-[11px] font-normal text-black/60 dark:text-white/60"
            >评分</span
          >
        </div>
        <span
          v-for="chip of chips"
          :key="chip.text"
          class="rounded px-1 text-[10px] leading-4 font-bold whitespace-nowrap"
          :class="chip.class"
          >{{ chip.text }}</span
        >
      </div>
    </template>
    <div class="w-44 text-xs">
      <div class="mb-1 flex items-baseline justify-between">
        <span class="font-bold">对局评分 {{ formatAkariRating(score.rating) }} / {{ AKARI_RATING_DISPLAY_MAX }}</span>
        <span class="text-[10px] text-black/60 dark:text-white/60">
          {{ positionText }}{{ chips.length ? ` · ${chips.map((c) => c.text).join(' · ')}` : '' }}
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

import {
  AKARI_GAME_TAG_LABELS,
  AKARI_METRIC_LABELS,
  AKARI_RATING_DISPLAY_MAX,
  type AkariGameTag,
  type AkariMetricKey,
  type AkariScore,
  formatAkariRating
} from '../utils/akari-score'

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

const TAG_CLASS: Record<AkariGameTag, string> = {
  carry: 'bg-sky-500/20 text-sky-700 dark:text-sky-300',
  stomp: 'bg-teal-500/20 text-teal-700 dark:text-teal-300',
  lying: 'bg-lime-500/20 text-lime-700 dark:text-lime-300',
  effort: 'bg-violet-500/20 text-violet-700 dark:text-violet-300',
  blame: 'bg-orange-500/20 text-orange-700 dark:text-orange-300',
  afk: 'bg-neutral-500/20 text-neutral-700 dark:text-neutral-300'
}

/** 芯片：荣誉徽标（MVP/SVP）在前，对局标签在后 */
const chips = computed(() => {
  const s = props.score
  if (!s) return []
  const out: Array<{ text: string; class: string }> = []
  if (s.rank > 0 && s.badge !== 'MVP') {
    out.push({
      text: `第${s.rank}名`,
      class:
        s.rank <= 3
          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-200'
          : 'bg-black/10 text-black/60 dark:bg-white/10 dark:text-white/60'
    })
  }
  if (s.badge === 'MVP') out.push({ text: 'MVP', class: 'bg-amber-500/20 text-amber-700 dark:text-amber-300' })
  if (s.badge === 'SVP') out.push({ text: 'SVP', class: 'bg-sky-500/20 text-sky-700 dark:text-sky-300' })
  if (s.tag) out.push({ text: AKARI_GAME_TAG_LABELS[s.tag], class: TAG_CLASS[s.tag] })
  return out
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
