<template>
  <div class="note-panel">
    <div class="note-heading">
      <span class="font-medium">我的对位笔记</span>
      <NText depth="3" class="text-xs">{{ statusText }}</NText>
    </div>
    <NInput
      :value="notes.state.text"
      type="textarea"
      :autosize="{ minRows: 3, maxRows: 8 }"
      :maxlength="MAX_REVIEW_NOTE_LENGTH"
      show-count
      :disabled="!scope"
      :readonly="notes.state.status === 'loading' || notes.state.status === 'error'"
      placeholder="记录可在下一局验证的细节，例如：关键技能冷却、回城时机、兵线处理。笔记仅保存在本机。"
      @update:value="notes.update"
      @blur="notes.flush"
    />
    <div v-if="notes.state.error" class="note-error">
      <NText type="error">{{ notes.state.error }}</NText>
      <NButton size="tiny" secondary type="error" @click="notes.retry">重试笔记</NButton>
    </div>
    <div class="note-hint">按当前登录账号、研究玩家、服务器、英雄、位置和对位独立保存。</div>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { SettingUtilsRenderer } from '@renderer-shared/shards/setting-utils'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { NButton, NInput, NText } from 'naive-ui'
import { computed } from 'vue'

import { MAX_REVIEW_NOTE_LENGTH, useReviewNotes, type ReviewNotesScope } from './notes'
import type { ReviewPosition } from './types'

const props = defineProps<{
  puuid: string
  sgpServerId: string
  championId: number
  position: ReviewPosition
  opponentChampionId: number | null
}>()
const settings = useInstance(SettingUtilsRenderer)
const lcs = useLeagueClientStore()
const sgps = useSgpStore()
const scope = computed<ReviewNotesScope | null>(() => {
  const ownerPuuid = lcs.summoner.me?.puuid
  const ownerServerId = sgps.availability.sgpServerId
  if (!ownerPuuid || !ownerServerId || !props.puuid || !props.sgpServerId) return null
  return {
    ownerPuuid,
    ownerServerId,
    targetPuuid: props.puuid,
    targetServerId: props.sgpServerId,
    championId: props.championId,
    position: props.position,
    opponentChampionId: props.opponentChampionId
  }
})
const notes = useReviewNotes(settings, scope)
const statusText = computed(() => {
  if (!scope.value) return '登录客户端后可编辑'
  return {
    idle: '自动保存至本机',
    loading: '正在读取',
    unsaved: '等待保存',
    saving: '正在保存',
    saved: '已保存',
    error: '笔记读写未完成'
  }[notes.state.status]
})
</script>

<style scoped>
.note-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
  background: rgb(var(--la-card-tint-rgb) / 0.025);
}
.note-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.note-error {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  flex-wrap: wrap;
}
.note-hint {
  font-size: 11px;
  opacity: 0.56;
}
</style>
