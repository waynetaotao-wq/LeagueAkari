<template>
  <div class="live-game-card" aria-live="polite">
    <ChampionIcon
      v-if="state.championId"
      :champion-id="state.championId"
      class="size-9 shrink-0 rounded"
    />
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <NTag
          :type="state.status === 'in-game' ? 'success' : 'default'"
          size="small"
          :bordered="false"
        >
          {{ t(`playerTabs.liveGame.status.${state.loading ? 'checking' : state.status}`) }}
        </NTag>
        <span v-if="queueName" class="text-sm">{{ queueName }}</span>
        <span v-if="state.gameId" class="text-xs opacity-60">#{{ state.gameId }}</span>
      </div>
      <div class="mt-1 text-xs opacity-70">
        {{ t(`playerTabs.liveGame.reason.${reason}`) }}
        <span v-if="state.checkedAt">
          ·
          {{
            t('playerTabs.liveGame.checkedAt', {
              time: new Date(state.checkedAt).toLocaleTimeString()
            })
          }}</span
        >
      </div>
    </div>
    <NButton
      v-if="state.status === 'in-game'"
      size="small"
      type="primary"
      secondary
      :disabled="!state.canSpectate || !canLaunch || state.loading"
      :loading="launching"
      @click="$emit('spectate')"
    >
      {{ t('playerTabs.liveGame.spectate') }}
    </NButton>
    <NButton
      size="small"
      secondary
      :loading="state.loading"
      :disabled="launching"
      @click="$emit('refresh')"
    >
      {{ t('playerTabs.liveGame.refresh') }}
    </NButton>
  </div>
</template>
<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useTranslation } from 'i18next-vue'
import { NButton, NTag } from 'naive-ui'
import type { PlayerLiveGameState } from './controller'
defineProps<{
  state: PlayerLiveGameState
  queueName: string
  reason: string
  canLaunch: boolean
  launching: boolean
}>()
defineEmits<{ refresh: []; spectate: [] }>()
const { t } = useTranslation()
</script>
<style scoped>
.live-game-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  border-radius: 8px;
  background: var(--la-card-surface-90);
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.18);
}
@media (max-width: 700px) {
  .live-game-card {
    flex-wrap: wrap;
  }
}
</style>
