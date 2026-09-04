<template>
  <NCard size="small" :title="text.chart">
    <template #header-extra>
      <NRadioGroup v-model:value="scope" size="small" :aria-label="text.chart">
        <NRadioButton value="both">{{ text.both }}</NRadioButton>
        <NRadioButton value="personal">{{ text.personal }}</NRadioButton>
        <NRadioButton value="team">{{ text.team }}</NRadioButton>
      </NRadioGroup>
    </template>
    <div v-if="hasData" class="chart-area">
      <Line :data="chartData" :options="chartOptions" :aria-label="text.chart" role="img" />
    </div>
    <NEmpty v-else :description="text.chartEmpty" class="py-8" />
    <NText depth="3" class="text-xs">{{ text.chartHint }}</NText>
  </NCard>
</template>

<script setup lang="ts">
import {
  Chart as ChartJS,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Tooltip,
  type ChartData,
  type ChartOptions
} from 'chart.js'
import { NCard, NEmpty, NRadioButton, NRadioGroup, NText, useThemeVars } from 'naive-ui'
import { computed, ref } from 'vue'
import { Line } from 'vue-chartjs'

import type { ReviewFrame, ReviewMoment } from './types'
import { reviewViewText as text } from './review-view-text'
import { reviewGoldPoints, reviewSigned, reviewTime } from './review-view-utils'

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend)

const props = defineProps<{
  frames: ReviewFrame[]
  frameIndex: number
  moment?: ReviewMoment | null
}>()
const emit = defineEmits<{ seek: [timestamp: number] }>()
const theme = useThemeVars()
const scope = ref<'personal' | 'team' | 'both'>('both')
const hasData = computed(() =>
  props.frames.some(
    (frame) =>
      (scope.value !== 'team' && frame.personalGoldDiff !== null) ||
      (scope.value !== 'personal' && frame.teamGoldDiff !== null)
  )
)

const chartData = computed<ChartData<'line', { x: number; y: number | null }[]>>(() => ({
  datasets: [
    {
      key: 'personalGoldDiff' as const,
      label: text.personalGold,
      color: theme.value.primaryColor,
      hidden: scope.value === 'team'
    },
    {
      key: 'teamGoldDiff' as const,
      label: text.teamGold,
      color: theme.value.infoColor,
      hidden: scope.value === 'personal'
    }
  ].map((dataset) => ({
    label: dataset.label,
    data: reviewGoldPoints(props.frames, dataset.key),
    borderColor: dataset.color,
    backgroundColor: dataset.color,
    hidden: dataset.hidden,
    borderWidth: 2,
    borderDash: dataset.key === 'teamGoldDiff' ? [6, 3] : [],
    tension: 0,
    spanGaps: false,
    pointRadius: reviewGoldPoints(props.frames, dataset.key).map((point) =>
      point.x === props.frames[props.frameIndex]?.timestamp
        ? 5
        : props.moment && point.x >= props.moment.start && point.x <= props.moment.end
          ? 3
          : 1
    ),
    pointHoverRadius: 5,
    pointHitRadius: 10
  }))
}))

const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  normalized: true,
  parsing: false,
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
  onClick: (event, _elements, chart) => {
    if (event.x === null || event.x === undefined) return
    const timestamp = chart.scales.x.getValueForPixel(event.x)
    if (Number.isFinite(timestamp)) emit('seek', Number(timestamp))
  },
  plugins: {
    datalabels: { display: false },
    legend: {
      position: 'bottom',
      labels: { color: theme.value.textColor2, usePointStyle: true, boxWidth: 8 }
    },
    tooltip: {
      callbacks: {
        title: (items) => (items[0] ? reviewTime(items[0].parsed.x ?? 0) : ''),
        label: (item) => `${item.dataset.label}：${reviewSigned(item.parsed.y)}`
      }
    }
  },
  scales: {
    x: {
      type: 'linear',
      min: props.frames[0]?.timestamp ?? 0,
      max: props.frames.at(-1)?.timestamp || 60_000,
      ticks: {
        color: theme.value.textColor3,
        maxTicksLimit: 7,
        callback: (value) => reviewTime(Number(value))
      },
      grid: { color: theme.value.dividerColor }
    },
    y: {
      ticks: { color: theme.value.textColor3, callback: (value) => reviewSigned(Number(value)) },
      grid: {
        color: (context) =>
          context.tick.value === 0 ? theme.value.textColor3 : theme.value.dividerColor
      }
    }
  }
}))
</script>

<style scoped>
.chart-area {
  height: 220px;
  min-width: 0;
}
:deep(.n-card-header) {
  flex-wrap: wrap;
  gap: 8px;
}
</style>
