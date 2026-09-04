<template>
  <div class="review-history">
    <NEmpty v-if="!matches.length" size="small" :description="emptyText" />
    <template v-else>
      <div
        v-for="match in visibleMatches"
        :key="match.meta.gameId"
        class="history-row"
        :class="{ selected: match.meta.gameId === selectedGameId }"
      >
        <div class="history-identity">
          <ChampionIcon :champion-id="match.meta.championId" class="size-8 shrink-0 rounded" />
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-medium">{{ resources.champions.name(match.meta.championId) }}</span>
              <span class="muted">对</span>
              <span>{{
                match.meta.opponentChampionId
                  ? resources.champions.name(match.meta.opponentChampionId)
                  : '对位未知'
              }}</span>
              <NTag size="tiny" :bordered="false" :type="match.meta.win ? 'success' : 'error'">{{
                match.meta.win ? '胜利' : '失败'
              }}</NTag>
            </div>
            <div class="history-meta">
              {{ reviewDate(match.meta.gameCreation) }} ·
              {{ REVIEW_POSITION_LABELS[match.meta.position] }} ·
              {{ resources.queues.name(match.meta.queueId) }} ·
              {{ match.meta.patch || '版本未知' }} ·
              {{ reviewClock(match.meta.gameDuration * 1000) }}
            </div>
          </div>
        </div>
        <div class="history-values">
          <div>
            <span class="muted">10 分钟经济差</span
            ><strong>{{
              reviewSigned(match.snapshots.find((s) => s.minute === 10)?.personalGoldDiff)
            }}</strong>
          </div>
          <div>
            <span class="muted">15 分钟经济差</span
            ><strong>{{
              reviewSigned(match.snapshots.find((s) => s.minute === 15)?.personalGoldDiff)
            }}</strong>
          </div>
        </div>
        <NButton
          size="small"
          secondary
          :type="match.meta.gameId === selectedGameId ? 'primary' : 'default'"
          @click="emit('open', match.meta.gameId)"
          >复盘此局</NButton
        >
      </div>
      <div v-if="matches.length > PAGE_SIZE" class="flex justify-end pt-2">
        <NPagination
          v-model:page="page"
          :page-size="PAGE_SIZE"
          :item-count="matches.length"
          :page-slot="5"
          size="small"
        />
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { NButton, NEmpty, NPagination, NTag } from 'naive-ui'
import { computed, ref, watch } from 'vue'

import { REVIEW_POSITION_LABELS, reviewClock, reviewDate, reviewSigned } from './review-display'
import type { ReviewMatch } from './types'

const props = withDefaults(
  defineProps<{ matches: ReviewMatch[]; selectedGameId?: number; emptyText?: string }>(),
  { emptyText: '当前筛选没有可复盘的对局' }
)
const emit = defineEmits<{ open: [gameId: number] }>()
const resources = useAkariResourceProvider()
const PAGE_SIZE = 8
const page = ref(1)
const visibleMatches = computed(() =>
  props.matches.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
)
watch(
  () => props.matches,
  () => {
    page.value = 1
  }
)
</script>

<style scoped>
.review-history {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.history-row {
  display: flex;
  align-items: center;
  gap: 16px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.09);
  border-radius: 6px;
  padding: 10px 12px;
  background: rgb(var(--la-card-tint-rgb) / 0.025);
}
.history-row.selected {
  border-color: var(--la-color-link);
}
.history-identity {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}
.history-meta {
  margin-top: 3px;
  font-size: 11px;
  opacity: 0.56;
  overflow-wrap: anywhere;
}
.history-values {
  display: flex;
  gap: 18px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.history-values > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.history-values strong {
  font-size: 13px;
  font-weight: 600;
}
.muted {
  opacity: 0.56;
}
@media (max-width: 720px) {
  .history-row {
    flex-wrap: wrap;
    gap: 10px;
  }
  .history-identity {
    flex-basis: 100%;
  }
  .history-values {
    flex: 1;
  }
}
</style>
