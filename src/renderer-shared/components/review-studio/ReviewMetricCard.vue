<template>
  <div class="metric-card">
    <div class="metric-label">{{ label }}</div>
    <NText :type="reviewValueTone(metric.mean)" strong class="metric-value"
      >{{ reviewSigned(metric.mean, digits)
      }}<span v-if="unit && metric.mean !== null" class="metric-unit">{{ unit }}</span></NText
    >
    <div class="metric-detail">{{ t('sampleCount', { count: metric.samples }) }}</div>
    <NPopover trigger="click">
      <template #trigger
        ><NButton text size="tiny" class="distribution-button">{{
          t('statsDetails')
        }}</NButton></template
      >
      <div class="distribution">
        <NText>{{
          t('range', {
            min: reviewSigned(metric.min, digits),
            max: reviewSigned(metric.max, digits)
          })
        }}</NText>
        <NText>{{
          t('deviation', {
            value:
              metric.standardDeviation === null
                ? '—'
                : metric.standardDeviation.toLocaleString('zh-CN', {
                    maximumFractionDigits: digits
                  })
          })
        }}</NText>
        <NText depth="3" class="text-xs">{{ t('deviationHint') }}</NText>
      </div>
    </NPopover>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import { NButton, NPopover, NText } from 'naive-ui'

import { reviewSigned } from './review-display'
import { reviewValueTone } from './review-insights'
import type { ReviewMetric } from './types'

withDefaults(
  defineProps<{ label: string; metric: ReviewMetric; digits?: number; unit?: string }>(),
  { digits: 0, unit: '' }
)
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
</script>

<style scoped>
.metric-card {
  min-width: 0;
  padding: 16px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 10px;
  background: rgb(var(--la-card-tint-rgb) / 0.025);
}
.metric-label {
  font-size: 12px;
  margin-bottom: 6px;
}
.metric-value {
  display: block;
  margin-bottom: 5px;
  font-size: 27px;
  font-variant-numeric: tabular-nums;
}
.metric-unit {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
}
.metric-detail {
  font-size: 12px;
  line-height: 1.7;
  opacity: 0.75;
}
.distribution-button {
  margin-top: 8px;
}
.distribution {
  display: flex;
  max-width: 280px;
  flex-direction: column;
  gap: 8px;
}
</style>
