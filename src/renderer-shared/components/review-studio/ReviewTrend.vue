<template>
  <div class="trend-panel">
    <div class="font-medium">近期与此前对比</div>
    <div v-if="!trend.recent.games" class="trend-hint">
      至少需要 2 场相同筛选的对局，才能分成互不重叠的两组。
    </div>
    <template v-else>
      <div class="trend-hint">
        按对局时间划分两组，每组 {{ trend.recent.games }} 场；每组最多 20
        场。不同对手、版本和样本构成仍可能影响差异。
      </div>
      <div class="trend-table" role="table" aria-label="近期与此前表现对比">
        <div class="trend-row trend-header" role="row">
          <div role="columnheader">指标</div>
          <div role="columnheader">近期</div>
          <div role="columnheader">此前</div>
          <div role="columnheader">均值变化</div>
        </div>
        <div v-for="item in metrics" :key="item.key" class="trend-row" role="row">
          <div role="cell">{{ item.label }}</div>
          <div role="cell">
            {{ reviewSigned(trend.recent[item.key].mean, item.digits)
            }}<span class="metric-samples">{{ trend.recent[item.key].samples }} 场</span>
          </div>
          <div role="cell">
            {{ reviewSigned(trend.previous[item.key].mean, item.digits)
            }}<span class="metric-samples">{{ trend.previous[item.key].samples }} 场</span>
          </div>
          <div role="cell">
            {{
              reviewSigned(
                difference(trend.recent[item.key], trend.previous[item.key]),
                item.digits
              )
            }}
          </div>
        </div>
      </div>
      <NCollapse>
        <NCollapseItem :title="`近期 ${trend.recent.games} 场 · 查看原始对局`" name="recent"
          ><ReviewHistory :matches="trend.recentMatches" @open="emit('open', $event)"
        /></NCollapseItem>
        <NCollapseItem :title="`此前 ${trend.previous.games} 场 · 查看原始对局`" name="previous"
          ><ReviewHistory :matches="trend.previousMatches" @open="emit('open', $event)"
        /></NCollapseItem>
      </NCollapse>
    </template>
  </div>
</template>

<script setup lang="ts">
import { NCollapse, NCollapseItem } from 'naive-ui'
import { computed } from 'vue'

import ReviewHistory from './ReviewHistory.vue'
import { reviewSigned } from './review-display'
import { buildReviewTrend } from './statistics'
import type { ReviewMatch, ReviewMetric } from './types'

const props = defineProps<{ matches: ReviewMatch[] }>()
const emit = defineEmits<{ open: [gameId: number] }>()
const trend = computed(() => buildReviewTrend(props.matches))
const metrics = [
  { key: 'gold10', label: '10 分钟经济差', digits: 0 },
  { key: 'gold15', label: '15 分钟经济差', digits: 0 },
  { key: 'cs10', label: '10 分钟补刀差', digits: 1 },
  { key: 'cs15', label: '15 分钟补刀差', digits: 1 }
] as const
function difference(recent: ReviewMetric, previous: ReviewMetric) {
  return recent.mean === null || previous.mean === null ? null : recent.mean - previous.mean
}
</script>

<style scoped>
.trend-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.trend-hint {
  font-size: 12px;
  line-height: 1.65;
  opacity: 0.6;
}
.trend-table {
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
  overflow: hidden;
}
.trend-row {
  display: grid;
  grid-template-columns: minmax(115px, 1.2fr) repeat(3, minmax(55px, 1fr));
  gap: 8px;
  padding: 9px 12px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.trend-header {
  border-top: 0;
  background: rgb(var(--la-card-tint-rgb) / 0.045);
  font-size: 11px;
  opacity: 0.65;
}
.metric-samples {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  opacity: 0.5;
}
@media (max-width: 480px) {
  .trend-row {
    grid-template-columns: minmax(84px, 1.2fr) repeat(3, minmax(42px, 1fr));
    padding: 8px;
    gap: 4px;
    font-size: 11px;
  }
}
</style>
