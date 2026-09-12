<template>
  <div class="overview">
    <div class="overview-heading">
      <div>
        <div class="eyebrow">
          {{ checkpoint ? t('checkpoint', { minute: checkpoint.minute }) : t('earlyMissing') }}
        </div>
        <div class="overview-title">
          {{
            t(overview.direction, {
              gold: Math.abs(checkpoint?.personalGoldDiff ?? 0).toLocaleString()
            })
          }}
        </div>
        <NText depth="3" class="text-xs">{{ t('comparisonHint') }}</NText>
      </div>
      <NTag v-if="checkpoint" size="small" :bordered="false">{{
        t('sampledAt', { time: reviewTime(checkpoint.timestamp!) })
      }}</NTag>
    </div>
    <div class="overview-metrics">
      <div v-for="metric in metrics" :key="metric.label" class="overview-metric">
        <span>{{ t(metric.label) }}</span>
        <NText :type="reviewValueTone(metric.value)" strong
          >{{ reviewSigned(metric.value) }}<small>{{ t(metric.unit) }}</small></NText
        >
      </div>
    </div>
    <div class="focus-panel">
      <div class="focus-copy">
        <div class="eyebrow">{{ t('focus') }}</div>
        <div class="focus-title">{{ overview.focus?.title ?? t('noFocus') }}</div>
        <NText depth="2" class="text-sm leading-6">{{
          overview.focus ? t(`questions.${overview.focus.kind}`) : t('noFocusHint')
        }}</NText>
        <NText depth="3" class="text-xs">{{
          overview.focus ? t('questionHint') : t('focusHint')
        }}</NText>
      </div>
      <NButton
        type="primary"
        secondary
        @click="
          overview.focus
            ? emit('moment', overview.focus)
            : emit('timeline', checkpoint?.timestamp ?? 0)
        "
      >
        {{ overview.focus ? t('startReview') : t('openTimeline') }}
      </NButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NButton, NTag, NText } from 'naive-ui'
import { computed } from 'vue'

import { getReviewOverview, reviewValueTone } from './review-insights'
import { reviewSigned, reviewTime } from './review-view-utils'
import type { ReviewMatch, ReviewMoment } from './types'

const props = defineProps<{ model: ReviewMatch }>()
const emit = defineEmits<{ moment: [moment: ReviewMoment]; timeline: [timestamp: number] }>()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
const overview = computed(() => getReviewOverview(props.model))
const checkpoint = computed(() => overview.value.checkpoint)
const metrics = computed(() => [
  { label: 'gold', value: checkpoint.value?.personalGoldDiff ?? null, unit: 'amount' },
  { label: 'cs', value: checkpoint.value?.personalCsDiff ?? null, unit: 'csUnit' },
  { label: 'teamGold', value: checkpoint.value?.teamGoldDiff ?? null, unit: 'amount' }
])
</script>

<style scoped>
.overview {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.overview-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.eyebrow {
  font-size: 12px;
  color: var(--la-color-link);
  font-weight: 600;
  margin-bottom: 6px;
}
.overview-title {
  font-size: 24px;
  font-weight: 650;
  line-height: 1.4;
  margin-bottom: 6px;
}
.overview-metrics {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.overview-metric {
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 10px;
  padding: 16px 18px;
  background: rgb(var(--la-card-tint-rgb) / 0.025);
}
.overview-metric > span {
  font-size: 12px;
}
.overview-metric > .n-text {
  font-size: 28px;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
}
.overview-metric small {
  font-size: 12px;
  font-weight: 400;
  margin-left: 6px;
  color: var(--la-color-text-primary);
}
.focus-panel {
  display: flex;
  align-items: center;
  gap: 24px;
  padding: 20px;
  border: 1px solid color-mix(in srgb, var(--la-color-link) 28%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--la-color-link) 6%, transparent);
}
.focus-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.focus-copy .eyebrow {
  margin: 0;
}
.focus-title {
  font-size: 18px;
  font-weight: 600;
}
@media (max-width: 640px) {
  .overview-title {
    font-size: 20px;
  }
  .overview-metrics {
    gap: 8px;
  }
  .overview-metric {
    padding: 12px;
  }
  .overview-metric > .n-text {
    font-size: 22px;
  }
  .overview-metric small {
    display: block;
    margin: 0;
  }
  .focus-panel {
    align-items: flex-start;
    flex-direction: column;
    gap: 14px;
    padding: 16px;
  }
}
</style>
