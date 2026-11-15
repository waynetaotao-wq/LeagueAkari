<template>
  <div class="gap-view">
    <NEmpty v-if="!matches.length" :description="t('outcomeGap.empty')" />
    <template v-else>
      <div class="gap-heading">
        <div>
          <div class="gap-title">{{ t('outcomeGap.title') }}</div>
          <div class="gap-hint">{{ t('outcomeGap.hint') }}</div>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          <NTag size="small" :bordered="false">{{
            t('outcomeGap.sample', {
              games: report.games,
              wins: report.wins,
              losses: report.losses
            })
          }}</NTag>
          <NTag v-if="fewGames" type="warning" size="small" :bordered="false">{{
            t('outcomeGap.fewGames')
          }}</NTag>
        </div>
      </div>
      <NAlert v-if="notEnough" type="warning" :show-icon="false">{{
        t('outcomeGap.notEnough', { count: REVIEW_GAP_MIN_SIDE })
      }}</NAlert>
      <NAlert v-if="mixedEnvironment" type="info" :show-icon="false">{{ t('mixed') }}</NAlert>
      <div v-for="group in groups" :key="group.id" class="gap-group">
        <div>
          <NText strong>{{ t(`outcomeGap.${group.id}`) }}</NText>
          <div class="gap-hint">{{ t(`outcomeGap.${group.id}Hint`) }}</div>
        </div>
        <NCollapse accordion>
          <NCollapseItem v-for="row in group.rows" :key="row.metric.id" :name="row.metric.id">
            <template #header>
              <div class="gap-row" :style="sideColors">
                <div class="gap-name">
                  <span class="font-medium">{{
                    t(`outcomeGap.metrics.${row.metric.id}.name`)
                  }}</span>
                  <span class="gap-hint">{{ sentence(row) }}</span>
                </div>
                <div class="gap-sides">
                  <div v-for="item in sides(row)" :key="item.id" class="gap-side">
                    <span class="gap-side-label">{{ t(`outcomeGap.${item.id}Side`) }}</span>
                    <strong>{{ format(row.metric, item.side.center) }}</strong>
                    <span class="gap-hint">{{
                      t('outcomeGap.samples', { count: item.side.samples })
                    }}</span>
                    <div class="gap-track" :class="`track-${item.id}`" aria-hidden="true">
                      <template v-if="item.band">
                        <span
                          class="gap-band"
                          :style="{ left: `${item.band.left}%`, width: `${item.band.width}%` }"
                        />
                        <span class="gap-dot" :style="{ left: `${item.band.center}%` }" />
                      </template>
                    </div>
                  </div>
                </div>
                <NTag size="small" :bordered="false" :type="STRENGTH_TONE[row.strength]">{{
                  t(`outcomeGap.strength.${row.strength}`)
                }}</NTag>
              </div>
            </template>
            <div class="gap-body">
              <div class="gap-hint">
                {{ t(`outcomeGap.metrics.${row.metric.id}.hint`) }} {{ t('outcomeGap.trackHint') }}
              </div>
              <div class="gap-values">
                <div v-for="item in sides(row)" :key="item.id" class="gap-value-column">
                  <NText depth="3" class="text-xs"
                    >{{ t(`outcomeGap.${item.id}Side`) }} ·
                    {{ t('outcomeGap.samples', { count: item.side.samples }) }}</NText
                  >
                  <NText v-if="!item.side.values.length" depth="3" class="text-xs">{{
                    t('outcomeGap.noValues')
                  }}</NText>
                  <div v-else class="flex flex-wrap gap-1.5">
                    <NButton
                      v-for="value in item.side.values"
                      :key="value.gameId"
                      size="tiny"
                      secondary
                      :title="reviewDate(value.gameCreation)"
                      @click="emit('open', value.gameId)"
                      >{{ format(row.metric, value.value, true) }}</NButton
                    >
                  </div>
                </div>
              </div>
              <div class="gap-hint">{{ t('outcomeGap.valuesHint') }}</div>
            </div>
          </NCollapseItem>
        </NCollapse>
      </div>
      <div class="gap-hint">
        {{ t('outcomeGap.note') }}
        <template v-if="report.legacyGames">
          {{ t('outcomeGap.legacy', { count: report.legacyGames }) }}</template
        >
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NTag,
  NText,
  useThemeVars
} from 'naive-ui'
import { computed } from 'vue'

import {
  REVIEW_GAP_CLEAR_MIN_SIDE,
  REVIEW_GAP_MIN_SIDE,
  type ReviewGapMetric,
  type ReviewGapRow,
  type ReviewGapSide,
  type ReviewGapStrength,
  compareReviewOutcomes,
  sortReviewGapRows
} from './outcome-gap'
import { reviewClock, reviewDate, reviewSigned } from './review-display'
import type { ReviewMatch } from './types'

const props = defineProps<{ matches: ReviewMatch[] }>()
const emit = defineEmits<{ open: [gameId: number] }>()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
const theme = useThemeVars()

const SIGNED = new Set<ReviewGapMetric['id']>(['csDiff10', 'goldDiff10', 'goldDiff15', 'plateDiff'])
const STRENGTH_TONE: Record<ReviewGapStrength, 'warning' | 'info' | 'default'> = {
  clear: 'warning',
  possible: 'info',
  none: 'default',
  insufficient: 'default'
}

const report = computed(() => compareReviewOutcomes(props.matches))
const groups = computed(() =>
  (['habit', 'result'] as const).map((id) => ({
    id,
    rows: sortReviewGapRows(report.value.rows.filter((row) => row.metric.group === id))
  }))
)
const notEnough = computed(
  () => report.value.wins < REVIEW_GAP_MIN_SIDE || report.value.losses < REVIEW_GAP_MIN_SIDE
)
const fewGames = computed(
  () =>
    !notEnough.value &&
    (report.value.wins < REVIEW_GAP_CLEAR_MIN_SIDE ||
      report.value.losses < REVIEW_GAP_CLEAR_MIN_SIDE)
)
const mixedEnvironment = computed(
  () =>
    new Set(props.matches.map((match) => match.meta.queueId)).size > 1 ||
    new Set(props.matches.map((match) => match.meta.patch)).size > 1
)
const sideColors = computed(() => ({
  '--gap-win': theme.value.successColor,
  '--gap-loss': theme.value.errorColor
}))

function trim(value: number, digits: number) {
  return Number(value.toFixed(digits)).toLocaleString('zh-CN', { maximumFractionDigits: digits })
}
/** Typical values keep one decimal; a single game's value is shown as recorded. */
function format(metric: ReviewGapMetric, value: number | null, single = false) {
  if (value === null) return '—'
  if (metric.unit === 'time') return reviewClock(value)
  const digits = single || metric.unit === 'gold' ? 0 : 1
  return SIGNED.has(metric.id) ? reviewSigned(value, digits) : trim(value, digits)
}
function sentence(row: ReviewGapRow) {
  if (row.strength === 'insufficient' || row.difference === null) return t('outcomeGap.unknown')
  const amount = Math.abs(row.difference)
  let value: string
  if (row.metric.unit === 'time') {
    const seconds = Math.round(amount / 1000)
    if (!seconds) return t('outcomeGap.same')
    value =
      seconds >= 60
        ? t('outcomeGap.duration', { minutes: Math.floor(seconds / 60), seconds: seconds % 60 })
        : t('outcomeGap.durationSeconds', { seconds })
  } else {
    const digits = row.metric.unit === 'gold' ? 0 : 1
    if (Number(amount.toFixed(digits)) === 0) return t('outcomeGap.same')
    value = trim(amount, digits)
  }
  return t(`outcomeGap.diff.${row.metric.unit}.${row.difference > 0 ? 'more' : 'less'}`, { value })
}
function sides(row: ReviewGapRow) {
  const bounds = [row.win, row.loss].flatMap((side) =>
    side.min === null || side.max === null ? [] : [side.min, side.max]
  )
  const low = Math.min(...bounds)
  const span = Math.max(...bounds) - low
  const place = (value: number) => (span > 0 ? ((value - low) / span) * 100 : 50)
  const band = (side: ReviewGapSide) =>
    side.center === null || side.q1 === null || side.q3 === null
      ? null
      : {
          left: place(side.q1),
          width: Math.max(1.5, place(side.q3) - place(side.q1)),
          center: place(side.center)
        }
  return [
    { id: 'win' as const, side: row.win, band: band(row.win) },
    { id: 'loss' as const, side: row.loss, band: band(row.loss) }
  ]
}
</script>

<style scoped>
.gap-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.gap-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.gap-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}
.gap-hint {
  font-size: 12px;
  opacity: 0.75;
  line-height: 1.7;
}
.gap-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.gap-row {
  display: grid;
  grid-template-columns: minmax(170px, 1fr) minmax(280px, 1.7fr) 10.5em;
  align-items: center;
  gap: 10px 18px;
  width: 100%;
  padding: 3px 0;
}
.gap-row > :deep(.n-tag) {
  justify-self: end;
}
.gap-name {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
/* 赢、输两行共用一张网格：色带上下对齐在同一把横向刻度上，重叠多少一眼可见。 */
.gap-sides {
  display: grid;
  grid-template-columns: max-content max-content max-content minmax(80px, 1fr);
  align-items: center;
  gap: 6px 10px;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.gap-side {
  display: contents;
}
.gap-side-label {
  font-size: 12px;
  opacity: 0.7;
}
.gap-side > strong {
  min-width: 3.2em;
  font-weight: 600;
}
.gap-side > .gap-hint {
  white-space: nowrap;
}
.gap-track {
  position: relative;
  height: 8px;
  border-radius: 4px;
  background: rgb(var(--la-card-tint-rgb) / 0.07);
}
.track-win {
  color: var(--gap-win);
}
.track-loss {
  color: var(--gap-loss);
}
.gap-band {
  position: absolute;
  top: 0;
  bottom: 0;
  border-radius: 4px;
  background: currentColor;
  opacity: 0.35;
}
.gap-dot {
  position: absolute;
  top: -2px;
  width: 4px;
  height: 12px;
  margin-left: -2px;
  border-radius: 2px;
  background: currentColor;
}
.gap-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 4px;
}
.gap-values {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}
.gap-value-column {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
@media (max-width: 720px) {
  .gap-row,
  .gap-values {
    grid-template-columns: 1fr;
  }
  .gap-row > :deep(.n-tag) {
    justify-self: start;
  }
}
</style>
