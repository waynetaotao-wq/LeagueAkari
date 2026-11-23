<template>
  <div class="baseline-view">
    <NText v-if="!baseline" depth="3" class="text-xs">{{
      t('baseline.none', { count: REVIEW_BASELINE_MIN_GAMES })
    }}</NText>
    <template v-else>
      <div class="baseline-hint">{{ scopeText }} {{ t('baseline.hint') }}</div>
      <div v-for="group in groups" :key="group.id" class="baseline-group">
        <NText strong class="text-xs">{{ t(`baseline.groups.${group.id}`) }}</NText>
        <div class="baseline-table" role="table" :aria-label="t(`baseline.groups.${group.id}`)">
          <div class="baseline-row baseline-header" role="row">
            <span role="columnheader">{{ t('baseline.columns.metric') }}</span>
            <span role="columnheader">{{ t('baseline.columns.game') }}</span>
            <span role="columnheader">{{ t('baseline.columns.usual') }}</span>
            <span role="columnheader">{{ t('baseline.columns.range') }}</span>
            <span role="columnheader">{{ t('baseline.columns.verdict') }}</span>
          </div>
          <div v-for="row in group.rows" :key="row.key" class="baseline-row" role="row">
            <span role="cell">{{ t(`baseline.metrics.${row.key}`) }}</span>
            <strong role="cell">{{ format(row, row.value) }}</strong>
            <span role="cell">{{ format(row, row.median) }}</span>
            <span role="cell" class="baseline-muted"
              >{{ format(row, row.q1) }} – {{ format(row, row.q3) }}</span
            >
            <span role="cell">
              <NTag size="small" :bordered="false" :type="tone(row)">{{
                t(`baseline.verdicts.${verdictKey(row)}`)
              }}</NTag>
            </span>
          </div>
        </div>
      </div>
      <div class="baseline-hint">{{ t('baseline.note') }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useTranslation } from 'i18next-vue'
import { NTag, NText } from 'naive-ui'
import { computed } from 'vue'

import {
  REVIEW_BASELINE_MIN_GAMES,
  type ReviewBaselineRow,
  compareToReviewBaseline,
  selectReviewBaseline
} from './baseline'
import type { ReviewDigestMetricKey } from './match-digest'
import { REVIEW_POSITION_LABELS, reviewClock, reviewSigned } from './review-display'
import type { ReviewMatch } from './types'

/** 界面上只列最常用的一部分指标；AI 教练拿到的是全部。 */
const GROUPS: Array<{ id: string; keys: ReviewDigestMetricKey[] }> = [
  {
    id: 'laning',
    keys: ['cs10', 'csDiff10', 'goldDiff10', 'xpDiff10', 'csDiff15', 'goldDiff15', 'level6Lead']
  },
  {
    id: 'income',
    keys: ['csPerMinute', 'goldPerMinute', 'damagePerMinute', 'damageShare', 'killParticipation']
  },
  { id: 'survival', keys: ['deaths', 'soloDeaths', 'deathsOutsideFights', 'deadShare'] },
  { id: 'tempo', keys: ['firstRecallAt', 'firstCoreAt', 'secondCoreAt'] },
  { id: 'vision', keys: ['visionPerMinute', 'controlWardsBought', 'wardsCleared'] },
  {
    id: 'teamplay',
    keys: [
      'fightsWon',
      'fightsDiedFirst',
      'epicCredited',
      'towersCredited',
      'enemyObjectivesAfterDeath'
    ]
  }
]

const props = defineProps<{
  model: ReviewMatch
  /** The same player's other games kept on this device; games without numbers are ignored. */
  archive: readonly ReviewMatch[]
}>()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
const resources = useAkariResourceProvider()

const baseline = computed(() => selectReviewBaseline(props.model, props.archive))
const rows = computed(() => {
  if (!baseline.value || !props.model.digest) return new Map<string, ReviewBaselineRow>()
  return new Map(
    compareToReviewBaseline(props.model.digest, baseline.value).map((row) => [row.key, row])
  )
})
const groups = computed(() =>
  GROUPS.map((group) => ({
    id: group.id,
    rows: group.keys.flatMap((key) => {
      const row = rows.value.get(key)
      return row ? [row] : []
    })
  })).filter((group) => group.rows.length)
)
const scopeText = computed(() => {
  const value = baseline.value
  if (!value) return ''
  const { meta } = props.model
  return t(`baseline.scope.${value.scope}`, {
    champion: resources.champions.name(meta.championId),
    position: REVIEW_POSITION_LABELS[meta.position],
    opponent:
      meta.opponentChampionId === null ? '' : resources.champions.name(meta.opponentChampionId),
    games: value.games,
    wins: value.wins
  })
})

const trim = (value: number) => String(Number(value.toFixed(1)))
function format(row: ReviewBaselineRow, value: number) {
  if (row.key === 'level2Lead' || row.key === 'level6Lead') {
    const seconds = Math.round(value / 1000)
    return seconds === 0
      ? t('baseline.sameTime')
      : t(seconds > 0 ? 'baseline.earlier' : 'baseline.later', { seconds: Math.abs(seconds) })
  }
  switch (row.unit) {
    case 'time':
      return reviewClock(value)
    case 'share':
      return `${Math.round(value * 100)}%`
    case 'diff':
      return reviewSigned(value, 1)
    default:
      return trim(value)
  }
}
function verdictKey(row: ReviewBaselineRow) {
  if (row.band === 'typical') return 'typical'
  // 没有好坏之分的时间类指标说「偏晚 / 偏早」，比「偏高 / 偏低」好懂。
  if (row.verdict === 'neutral' && row.unit === 'time')
    return row.band === 'above'
      ? row.extreme
        ? 'muchLater'
        : 'later'
      : row.extreme
        ? 'muchEarlier'
        : 'earlier'
  if (row.verdict === 'neutral')
    return row.band === 'above'
      ? row.extreme
        ? 'muchHigher'
        : 'higher'
      : row.extreme
        ? 'muchLower'
        : 'lower'
  return row.verdict === 'better'
    ? row.extreme
      ? 'muchBetter'
      : 'better'
    : row.extreme
      ? 'muchWorse'
      : 'worse'
}
function tone(row: ReviewBaselineRow) {
  if (!row.extreme || row.verdict === 'neutral') return 'default'
  return row.verdict === 'better' ? 'success' : 'error'
}
</script>

<style scoped>
.baseline-view {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.baseline-hint {
  font-size: 12px;
  opacity: 0.72;
  line-height: 1.7;
}
.baseline-muted {
  opacity: 0.6;
}
.baseline-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.baseline-table {
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
  overflow: hidden;
}
.baseline-row {
  display: grid;
  grid-template-columns:
    minmax(150px, 1.6fr) minmax(64px, 0.7fr) minmax(64px, 0.7fr) minmax(110px, 1fr)
    9.5em;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.baseline-row:first-child {
  border-top: 0;
}
.baseline-row > * {
  min-width: 0;
  overflow-wrap: anywhere;
}
/* 较长的结论（英文界面）在标签里换行，不撑出表格。 */
.baseline-row :deep(.n-tag) {
  max-width: 100%;
  height: auto;
  padding-top: 2px;
  padding-bottom: 2px;
  line-height: 1.35;
  white-space: normal;
}
.baseline-header {
  background: rgb(var(--la-card-tint-rgb) / 0.045);
  font-size: 11px;
  opacity: 0.65;
}
@media (max-width: 720px) {
  .baseline-row {
    grid-template-columns: minmax(110px, 1.4fr) minmax(52px, 0.7fr) minmax(52px, 0.7fr) 8.5em;
    gap: 6px;
    padding: 7px 8px;
  }
  /* 窄屏下省掉「平时多数」一列，其余四列保持对齐。 */
  .baseline-row > :nth-child(4) {
    display: none;
  }
}
</style>
