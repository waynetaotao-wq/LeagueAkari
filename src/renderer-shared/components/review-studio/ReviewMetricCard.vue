<template>
  <div class="metric-card">
    <div class="metric-label">{{ label }}</div>
    <div class="metric-value">
      {{ reviewSigned(metric.mean, digits)
      }}<span v-if="unit && metric.mean !== null" class="metric-unit">{{ unit }}</span>
    </div>
    <div class="metric-detail">
      {{ metric.samples }} 场有效 · 范围 {{ reviewSigned(metric.min, digits) }} ～
      {{ reviewSigned(metric.max, digits) }}
    </div>
    <NTooltip trigger="hover">
      <template #trigger
        ><div class="metric-detail">
          标准差
          {{
            metric.standardDeviation === null
              ? '—'
              : metric.standardDeviation.toLocaleString('zh-CN', { maximumFractionDigits: digits })
          }}
        </div></template
      >
      标准差反映这些对局之间的离散程度，不是均值误差或置信区间；少于 2 场不计算。
    </NTooltip>
  </div>
</template>

<script setup lang="ts">
import { NTooltip } from 'naive-ui'

import { reviewSigned } from './review-display'
import type { ReviewMetric } from './types'

withDefaults(
  defineProps<{ label: string; metric: ReviewMetric; digits?: number; unit?: string }>(),
  { digits: 0, unit: '' }
)
</script>

<style scoped>
.metric-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.09);
  border-radius: 6px;
  background: rgb(var(--la-card-tint-rgb) / 0.035);
}
.metric-label {
  font-size: 12px;
  opacity: 0.65;
}
.metric-value {
  margin: 3px 0 5px;
  font-size: 23px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.metric-unit {
  margin-left: 4px;
  font-size: 12px;
  font-weight: 400;
  opacity: 0.6;
}
.metric-detail {
  font-size: 11px;
  opacity: 0.55;
  line-height: 1.7;
  font-variant-numeric: tabular-nums;
}
</style>
