<template>
  <div v-if="eligible" class="shrink-0 border-t border-white/10 px-3.5 py-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-xs font-semibold">本局关键复盘</span>
      <NButton size="tiny" secondary :loading="opening" @click="openTarget">在主窗口查看</NButton>
    </div>
    <div v-if="busy" class="mt-1.5 flex items-center gap-2 text-xs opacity-60">
      <NSpin :size="12" /> 正在分析本局时间线…
    </div>
    <template v-else-if="selectedMatch">
      <div
        v-for="moment of selectedMatch.moments.slice(0, 2)"
        :key="moment.id"
        class="mt-1.5 flex gap-2 text-xs"
      >
        <span class="shrink-0 tabular-nums opacity-60"
          >{{ reviewTime(moment.start) }}–{{ reviewTime(moment.end) }}</span
        >
        <span class="min-w-0 truncate" :title="moment.description">{{ moment.title }}</span>
      </div>
      <div v-if="!selectedMatch.moments.length" class="mt-1.5 text-xs opacity-60">
        未识别到符合条件的片段，可查看地图和经济走势。
      </div>
    </template>
    <div v-else class="mt-1.5 flex items-center gap-2 text-xs opacity-65">
      <span class="min-w-0 flex-1">{{
        error || availability.reason || '打开复盘台查看地图与经济走势。'
      }}</span>
      <NButton
        v-if="error && availability.ready"
        size="tiny"
        quaternary
        @click="loadMatch(summary.gameId)"
        >重试</NButton
      >
    </div>
    <div v-if="openError" class="mt-1 text-xs text-red-300">{{ openError }}</div>
  </div>
</template>

<script setup lang="ts">
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { usePostGameWindowStore } from '@renderer-shared/shards/window-manager/store'
import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { NButton, NSpin } from 'naive-ui'
import { computed, watch } from 'vue'

import { getReviewSummaryEligibility } from './analysis'
import { reviewTime } from './review-view-utils'
import { useOpenReviewStudio } from './use-open-review-studio'
import { useReviewData } from './use-review-data'

const props = defineProps<{ summary: LcuOrSgpGameSummary; puuid: string; sgpServerId: string }>()
const postGameWindow = usePostGameWindowStore()
const leagueClient = useLeagueClientStore()
const eligible = computed(
  () =>
    props.summary.source === 'sgp' &&
    getReviewSummaryEligibility(props.summary.data, props.puuid).ok
)
const active = computed(
  () =>
    postGameWindow.show &&
    leagueClient.isConnected &&
    eligible.value &&
    !['ChampSelect', 'GameStart', 'InProgress', 'Reconnect'].includes(
      String(leagueClient.gameflow.phase)
    )
)
const { loadMatch, selectedMatch, busy, error, availability } = useReviewData({
  puuid: () => props.puuid,
  sgpServerId: () => props.sgpServerId,
  active,
  persistArchive: false
})
const { open, opening, error: openError } = useOpenReviewStudio()
const openTarget = () =>
  open({
    puuid: props.puuid,
    sgpServerId: props.sgpServerId,
    gameId: props.summary.gameId,
    championId:
      props.summary.source === 'sgp'
        ? props.summary.data.json.participants.find((p) => p.puuid === props.puuid)?.championId
        : undefined
  })

watch(
  () =>
    [
      active.value,
      availability.value.ready,
      props.summary.gameId,
      props.puuid,
      props.sgpServerId
    ] as const,
  ([visible, ready, gameId]) => {
    if (visible && ready) void loadMatch(gameId)
  },
  { immediate: true }
)
</script>
