<template>
  <div v-if="compact" class="flex flex-wrap items-center justify-end gap-2">
    <span v-if="error" class="text-xs text-red-500">{{ error }}</span>
    <NButton
      size="tiny"
      secondary
      :disabled="!puuid || !sgpServerId"
      :loading="opening"
      @click="openTarget"
    >
      关键片段与地图复盘
    </NButton>
  </div>
  <NCard v-else size="small" :bordered="false" class="bg-(--la-card-muted-surface)">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-semibold">个人复盘台</span>
      <NTag size="small" :bordered="false">赛后训练</NTag>
    </div>
    <div class="mt-2 text-xs leading-relaxed opacity-65">
      关键片段 · 对位档案 · 地图回放 · 领先兑现
    </div>
    <NButton
      class="mt-3"
      size="small"
      secondary
      block
      :disabled="!puuid || !sgpServerId"
      :loading="opening"
      @click="openTarget"
    >
      打开复盘台
    </NButton>
    <div v-if="error" class="mt-2 text-xs text-red-500">{{ error }}</div>
  </NCard>
</template>

<script setup lang="ts">
import { NButton, NCard, NTag } from 'naive-ui'

import { useOpenReviewStudio } from './use-open-review-studio'

const props = defineProps<{
  puuid: string
  sgpServerId: string
  gameId?: number
  championId?: number
  compact?: boolean
}>()
const { open, opening, error } = useOpenReviewStudio()
const openTarget = () =>
  open({
    puuid: props.puuid,
    sgpServerId: props.sgpServerId,
    gameId: props.gameId,
    championId: props.championId
  })
</script>
