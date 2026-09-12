<template>
  <div class="match-view">
    <div class="match-heading">
      <div class="match-identity">
        <ChampionIcon :champion-id="model.meta.championId" class="size-12! shrink-0 rounded-lg" />
        <div class="min-w-0">
          <div class="match-name">
            <NText strong>{{ resources.champions.name(model.meta.championId) }}</NText>
            <NText depth="3" class="text-xs"
              >{{ REVIEW_POSITION_LABELS[model.meta.position] }} · {{ text.versus }}</NText
            >
            <ChampionIcon
              v-if="model.meta.opponentChampionId"
              :champion-id="model.meta.opponentChampionId"
              class="size-6! rounded"
            />
            <NText class="text-sm">{{
              model.meta.opponentChampionId
                ? resources.champions.name(model.meta.opponentChampionId)
                : text.unknownOpponent
            }}</NText>
          </div>
          <NText depth="3" class="text-xs"
            >{{ resources.queues.name(model.meta.queueId) }} · {{ creationDate }} ·
            {{ reviewTime(model.meta.gameDuration * 1000) }} · {{ text.patch }}
            {{ model.meta.patch }}</NText
          >
        </div>
      </div>
      <NTag :type="model.meta.win ? 'success' : 'error'" :bordered="false" size="large">{{
        model.meta.win ? text.victory : text.defeat
      }}</NTag>
    </div>
    <div class="match-navigation">
      <NRadioGroup v-model:value="view" :aria-label="text.review" size="small">
        <NRadioButton value="overview">{{ t('overview') }}</NRadioButton>
        <NRadioButton value="timeline">{{ t('timeline') }}</NRadioButton>
        <NRadioButton value="details">{{ t('details') }}</NRadioButton>
      </NRadioGroup>
      <NButton
        v-if="model.quality.warnings.length"
        size="tiny"
        quaternary
        type="warning"
        @click="view = 'details'"
        >{{ t('quality') }} · {{ model.quality.warnings.length }}</NButton
      >
    </div>
    <template v-if="view === 'overview'">
      <ReviewOverview :model="model" @moment="selectMoment" @timeline="openTimeline" />
      <ReviewMoments :model="model" @select="selectMoment" />
    </template>
    <div v-if="view === 'timeline'" ref="replayRoot" class="replay-view">
      <div class="replay-context">
        <NButton size="small" quaternary @click="view = 'overview'">← {{ t('back') }}</NButton>
        <NText v-if="selectedMoment" strong
          >{{ selectedMoment.title }} · {{ reviewTime(selectedMoment.start) }}–{{
            reviewTime(selectedMoment.end)
          }}</NText
        >
        <NButton v-if="selectedMoment" size="small" secondary @click="selectMoment(null)">{{
          t('exitMoment')
        }}</NButton>
      </div>
      <ReviewTimeline
        :model="model"
        :frame-index="frameIndex"
        :active="active && view === 'timeline'"
        :seek-token="seekToken"
        :selected-event-id="selectedEventId"
        :moment="selectedMoment"
        @frame="setFrame"
        @event="selectEvent"
      />
      <NAlert
        v-if="selectedMoment"
        :type="selectedMoment.kind === 'gold-gain' ? 'success' : 'info'"
        :show-icon="false"
        :title="t('evidence')"
      >
        <div class="text-xs leading-5">{{ selectedMoment.description }}</div>
      </NAlert>
      <ReviewGoldChart
        :frames="model.frames"
        :frame-index="frameIndex"
        :moment="selectedMoment"
        @seek="openTimeline"
      />
    </div>
    <div v-if="view === 'details'" class="detail-view">
      <div class="section-heading">
        <NText strong>{{ t('checkpoints') }}</NText
        ><NText depth="3" class="text-xs">{{ t('checkpointHint') }}</NText>
      </div>
      <div class="snapshot-table" role="table" :aria-label="t('checkpoints')">
        <div class="snapshot-row snapshot-header" role="row">
          <div role="columnheader">{{ t('minute') }}</div>
          <div role="columnheader">{{ t('gold') }}</div>
          <div role="columnheader">{{ t('cs') }}</div>
          <div role="columnheader">{{ t('teamGold') }}</div>
          <div role="columnheader">{{ t('actualTime') }}</div>
        </div>
        <div
          v-for="snapshot in model.snapshots"
          :key="snapshot.minute"
          class="snapshot-row"
          role="row"
        >
          <div role="cell">{{ text.checkpoint(snapshot.minute) }}</div>
          <div role="cell">
            <NText :type="reviewValueTone(snapshot.personalGoldDiff)" strong>{{
              reviewSigned(snapshot.personalGoldDiff)
            }}</NText>
          </div>
          <div role="cell">
            <NText :type="reviewValueTone(snapshot.personalCsDiff)">{{
              reviewSigned(snapshot.personalCsDiff)
            }}</NText>
          </div>
          <div role="cell">
            <NText :type="reviewValueTone(snapshot.teamGoldDiff)">{{
              reviewSigned(snapshot.teamGoldDiff)
            }}</NText>
          </div>
          <div role="cell">
            <NButton
              v-if="snapshot.timestamp !== null"
              size="tiny"
              secondary
              @click="openTimeline(snapshot.timestamp)"
              >{{ reviewTime(snapshot.timestamp) }} ↗</NButton
            ><NText v-else depth="3" class="text-xs">{{
              t(model.meta.gameDuration < snapshot.minute * 60 ? 'notReached' : 'missing')
            }}</NText>
          </div>
        </div>
      </div>
      <NCard size="small" :title="t('quality')">
        <div class="flex flex-col gap-3">
          <NText>{{
            t('qualitySummary', {
              coverage: `${Math.round(model.quality.timelineCoverage * 100)}%`,
              status: t(model.quality.eventCoverage === 'complete' ? 'reconciled' : 'partial')
            })
          }}</NText>
          <NText depth="3" class="text-xs">{{ t('qualityHint') }}</NText>
          <NAlert v-if="model.quality.warnings.length" type="warning" :show-icon="false"
            ><div
              v-for="warning in model.quality.warnings"
              :key="warning"
              class="text-xs leading-6"
            >
              {{ warning }}
            </div></NAlert
          >
          <NText depth="3" class="text-xs"
            >SGP · {{ model.meta.sgpServerId }} · {{ text.game }} {{ model.meta.gameId }}</NText
          >
        </div>
      </NCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useTranslation } from 'i18next-vue'
import { NAlert, NButton, NCard, NRadioButton, NRadioGroup, NTag, NText } from 'naive-ui'
import { computed, nextTick, ref, watch } from 'vue'

import ReviewGoldChart from './ReviewGoldChart.vue'
import ReviewMoments from './ReviewMoments.vue'
import ReviewOverview from './ReviewOverview.vue'
import ReviewTimeline from './ReviewTimeline.vue'
import { REVIEW_POSITION_LABELS } from './review-display'
import { reviewValueTone } from './review-insights'
import { reviewViewText as text } from './review-view-text'
import { findReviewFrameIndex, reviewSigned, reviewTime } from './review-view-utils'
import type { ReviewEvent, ReviewMatch, ReviewMoment } from './types'

const props = withDefaults(defineProps<{ model: ReviewMatch; active?: boolean }>(), {
  active: true
})
const resources = useAkariResourceProvider()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
const replayRoot = ref<HTMLElement | null>(null)
const view = ref<'overview' | 'timeline' | 'details'>('overview')
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
  if (
    selectedMoment.value &&
    (timestamp < selectedMoment.value.start || timestamp > selectedMoment.value.end)
  )
    selectedMoment.value = null
}
async function openTimeline(timestamp: number) {
  view.value = 'timeline'
  seek(timestamp)
  await nextTick()
  replayRoot.value?.scrollIntoView({ block: 'start' })
}
function setFrame(index: number) {
  selectedEventId.value = null
  frameIndex.value = Math.max(0, Math.min(props.model.frames.length - 1, index))
}
function selectMoment(moment: ReviewMoment | null) {
  selectedMoment.value = moment
  if (moment) {
    void openTimeline(moment.start)
    const relatedDeaths = props.model.events.filter(
      (value) =>
        moment.eventIds.includes(value.id) && value.victimId === props.model.meta.participantId
    )
    const event =
      moment.scope !== null
        ? null
        : moment.kind === 'shutdown'
          ? relatedDeaths.sort((a, b) => (b.shutdownBounty ?? 0) - (a.shutdownBounty ?? 0))[0]
          : relatedDeaths[0]
    if (event) selectEvent(event)
  }
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
    view.value = 'overview'
  }
)
</script>

<style scoped>
.match-view,
.replay-view,
.detail-view {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 20px;
}
.match-view {
  scroll-margin-top: 12px;
}
.match-heading,
.match-navigation,
.replay-context {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.match-heading {
  padding-bottom: 18px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
}
.match-identity,
.match-name {
  display: flex;
  align-items: center;
  gap: 10px;
}
.match-name {
  flex-wrap: wrap;
  font-size: 18px;
  margin-bottom: 6px;
}
.match-identity {
  min-width: 0;
  flex: 1;
}
.replay-context {
  justify-content: flex-start;
}
.section-heading {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.snapshot-table {
  overflow-x: auto;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 8px;
}
.snapshot-row {
  display: grid;
  grid-template-columns: 0.8fr 1fr 1fr 1fr 1.2fr;
  align-items: center;
  min-width: 530px;
  gap: 10px;
  padding: 14px 16px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}
.snapshot-row + .snapshot-row {
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
}
.snapshot-header {
  background: rgb(var(--la-card-tint-rgb) / 0.04);
  font-size: 12px;
}
</style>
