<template>
  <div class="flex min-w-0 flex-col gap-4">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex min-w-0 items-center gap-3">
        <ChampionIcon :champion-id="model.meta.championId" class="size-10! rounded" />
        <div class="flex min-w-0 flex-col gap-1">
          <div class="flex flex-wrap items-center gap-2">
            <NText strong>{{ resources.champions.name(model.meta.championId) }}</NText>
            <NText depth="3" class="text-xs">{{ text.versus }}</NText>
            <template v-if="model.meta.opponentChampionId !== null">
              <ChampionIcon :champion-id="model.meta.opponentChampionId" class="size-5! rounded" />
              <NText>{{ resources.champions.name(model.meta.opponentChampionId) }}</NText>
            </template>
            <NText v-else depth="3">{{ text.unknownOpponent }}</NText>
          </div>
          <NText depth="3" class="text-xs"
            >{{ resources.queues.name(model.meta.queueId) }} · {{ creationDate }} ·
            {{ reviewTime(model.meta.gameDuration * 1000) }}</NText
          >
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <NTag :type="model.meta.win ? 'success' : 'error'" :bordered="false">{{
          model.meta.win ? text.victory : text.defeat
        }}</NTag>
        <NText depth="3" class="text-xs"
          >{{ text.patch }} {{ model.meta.patch || '—' }} · {{ text.game }}
          {{ model.meta.gameId }}</NText
        >
      </div>
    </div>
    <NAlert v-if="model.quality.warnings.length" type="warning" :show-icon="false">
      <div v-for="warning in model.quality.warnings" :key="warning" class="text-xs leading-5">
        {{ warning }}
      </div>
    </NAlert>
    <div class="flex flex-col gap-2">
      <NText strong>{{ text.snapshots }}</NText>
      <div class="snapshot-grid">
        <NCard
          v-for="snapshot in model.snapshots"
          :key="snapshot.minute"
          size="small"
          :title="text.checkpoint(snapshot.minute)"
        >
          <div class="flex flex-col gap-2 text-xs tabular-nums">
            <div class="flex justify-between gap-2">
              <NText depth="3">{{ text.personalGold }}</NText
              ><NText strong>{{ reviewSigned(snapshot.personalGoldDiff) }}</NText>
            </div>
            <div class="flex justify-between gap-2">
              <NText depth="3">{{ text.personalCs }}</NText
              ><NText>{{ reviewSigned(snapshot.personalCsDiff) }}</NText>
            </div>
            <div class="flex justify-between gap-2">
              <NText depth="3">{{ text.teamGold }}</NText
              ><NText>{{ reviewSigned(snapshot.teamGoldDiff) }}</NText>
            </div>
            <NButton
              v-if="snapshot.timestamp !== null"
              size="tiny"
              quaternary
              @click="seek(snapshot.timestamp)"
              >{{ text.sampledAt(reviewTime(snapshot.timestamp)) }}</NButton
            >
            <NText v-else depth="3">{{ text.snapshotMissing }}</NText>
          </div>
        </NCard>
      </div>
      <NText depth="3" class="text-xs">{{ text.signedHint }}</NText>
    </div>
    <ReviewMoments :model="model" :selected-id="selectedMoment?.id" @select="selectMoment" />
    <ReviewGoldChart
      :frames="model.frames"
      :frame-index="frameIndex"
      :moment="selectedMoment"
      @seek="seek"
    />
    <ReviewTimeline
      :model="model"
      :frame-index="frameIndex"
      :active="active"
      :seek-token="seekToken"
      :selected-event-id="selectedEventId"
      :moment="selectedMoment"
      @frame="setFrame"
      @event="selectEvent"
    />
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { NAlert, NButton, NCard, NTag, NText } from 'naive-ui'
import { computed, ref, watch } from 'vue'

import ReviewGoldChart from './ReviewGoldChart.vue'
import ReviewMoments from './ReviewMoments.vue'
import ReviewTimeline from './ReviewTimeline.vue'
import type { ReviewEvent, ReviewMatch, ReviewMoment } from './types'
import { reviewViewText as text } from './review-view-text'
import { findReviewFrameIndex, reviewSigned, reviewTime } from './review-view-utils'

const props = withDefaults(defineProps<{ model: ReviewMatch; active?: boolean }>(), {
  active: true
})
const resources = useAkariResourceProvider()
const frameIndex = ref(0)
const selectedMoment = ref<ReviewMoment | null>(null)
const selectedEventId = ref<string | null>(null)
const seekToken = ref(0)
const creationDate = computed(() =>
  new Date(props.model.meta.gameCreation).toLocaleString(resources.runtime.locale, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
)
function seek(timestamp: number) {
  seekToken.value++
  selectedEventId.value = null
  frameIndex.value = Math.max(0, findReviewFrameIndex(props.model.frames, timestamp))
}
function setFrame(index: number) {
  selectedEventId.value = null
  frameIndex.value = Math.max(0, Math.min(props.model.frames.length - 1, index))
}
function selectMoment(moment: ReviewMoment | null) {
  selectedMoment.value = moment
  if (moment) seek(moment.start)
}
function selectEvent(event: ReviewEvent) {
  seekToken.value++
  frameIndex.value = Math.max(0, findReviewFrameIndex(props.model.frames, event.timestamp))
  selectedEventId.value = event.id
}
watch(
  () => props.model,
  () => {
    frameIndex.value = 0
    selectedMoment.value = null
    selectedEventId.value = null
  }
)
</script>

<style scoped>
.snapshot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr));
  gap: 12px;
}
</style>
