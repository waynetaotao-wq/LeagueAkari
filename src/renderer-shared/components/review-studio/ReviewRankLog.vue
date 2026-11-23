<template>
  <div class="rank-view" :style="toneColors">
    <div class="rank-heading">
      <div class="rank-hint">{{ t('rankLog.hint') }}</div>
      <div class="flex flex-wrap items-center gap-3">
        <NRadioGroup v-model:value="queueType" size="small" @update:value="queueTouched = true">
          <NRadioButton v-for="type in RANK_LOG_QUEUE_TYPES" :key="type" :value="type">{{
            tc(`queueTypes.${type}`, { ns: 'common' })
          }}</NRadioButton>
        </NRadioGroup>
        <label class="flex items-center gap-1.5 text-xs">
          <NSwitch
            size="small"
            :value="store.settings.enabled"
            :disabled="!store.state.available"
            @update:value="rankLog.setEnabled($event)"
          />{{ t('rankLog.autoRecord') }}
        </label>
        <NButton
          size="small"
          secondary
          :loading="syncing || store.state.syncing"
          :disabled="!store.state.available || !store.settings.enabled"
          @click="sync"
          >{{ t('rankLog.sync') }}</NButton
        >
      </div>
    </div>

    <NAlert v-if="!store.state.available" type="warning" :show-icon="false">{{
      t('rankLog.unavailable')
    }}</NAlert>
    <NAlert v-else-if="!store.settings.enabled" type="info" :show-icon="false">{{
      t('rankLog.disabled')
    }}</NAlert>
    <NAlert
      v-if="syncMessage"
      :type="syncMessage.type"
      :show-icon="false"
      closable
      @close="syncMessage = null"
      >{{ syncMessage.text }}</NAlert
    >
    <NAlert v-if="tilt" :type="tilt.verdict === 'notWorse' ? 'info' : 'warning'" :show-icon="false">
      {{ t('rankLog.alert.lossStreak', { count: tilt.count }) }}
      {{ t(`rankLog.alert.${tilt.verdict}`, tilt.values) }}
    </NAlert>

    <NEmpty v-if="loaded && !entries.length" :description="t('rankLog.empty')" class="py-10" />
    <NEmpty
      v-else-if="loaded && !queueEntries.length"
      :description="t('rankLog.emptyQueue')"
      class="py-10"
    />
    <template v-else-if="queueEntries.length">
      <div class="rank-cards">
        <div class="rank-card">
          <span class="rank-label">{{ tc(`queueTypes.${queueType}`, { ns: 'common' }) }}</span>
          <strong>{{ rankText(summary.current) }}</strong>
          <span class="rank-hint">{{
            summary.current
              ? t('rankLog.record', {
                  wins: summary.current.wins ?? 0,
                  losses: summary.current.losses ?? 0
                })
              : t('rankLog.cards.none')
          }}</span>
        </div>
        <div class="rank-card">
          <span class="rank-label">{{ t('rankLog.cards.net') }}</span>
          <strong :class="toneOf(summary.net)">{{ reviewSigned(summary.net) }}</strong>
          <span class="rank-hint">{{
            summary.netSince === null
              ? t('rankLog.cards.none')
              : t('rankLog.cards.since', { date: reviewDate(summary.netSince) })
          }}</span>
        </div>
        <div class="rank-card">
          <span class="rank-label">{{
            t('rankLog.cards.recent', { count: summary.recent.games })
          }}</span>
          <strong>{{ recordText(summary.recent) }}</strong>
          <span class="rank-hint">{{ rateText(summary.recent) }}</span>
        </div>
        <div class="rank-card">
          <span class="rank-label">{{ t('rankLog.cards.streak') }}</span>
          <strong :class="summary.streak ? (summary.streak.win ? 'tone-win' : 'tone-loss') : ''">{{
            summary.streak
              ? t(`rankLog.cards.${summary.streak.win ? 'winStreak' : 'lossStreak'}`, {
                  count: summary.streak.length
                })
              : t('rankLog.cards.none')
          }}</strong>
          <span class="rank-hint">{{ todayText }}</span>
        </div>
        <div class="rank-card">
          <span class="rank-label">{{ t('rankLog.cards.average') }}</span>
          <strong>
            <span class="tone-win">{{
              t('rankLog.cards.averageWin', { value: reviewSigned(summary.averageWinLp, 1) })
            }}</span>
            <span class="rank-separator">/</span>
            <span class="tone-loss">{{
              t('rankLog.cards.averageLoss', { value: reviewSigned(summary.averageLossLp, 1) })
            }}</span>
          </strong>
          <span class="rank-hint">{{
            t('rankLog.form.games', { count: summary.total.lpGames })
          }}</span>
        </div>
      </div>

      <NCard size="small" :title="t('rankLog.chart.title')">
        <div v-if="chartPoints.length >= 2" class="chart-area">
          <Line
            :data="chartData"
            :options="chartOptions"
            :aria-label="t('rankLog.chart.title')"
            role="img"
          />
        </div>
        <NEmpty v-else :description="t('rankLog.chart.empty')" class="py-8" />
        <NText depth="3" class="text-xs">{{ t('rankLog.chart.hint') }}</NText>
      </NCard>

      <div class="rank-columns">
        <NCard size="small" :title="t('rankLog.form.title')">
          <div class="rank-table" role="table" :aria-label="t('rankLog.form.title')">
            <div
              v-for="row in formRows"
              :key="row.key"
              class="rank-row form-row"
              :class="{ emphasized: row.emphasized }"
              role="row"
            >
              <span role="cell">{{ row.label }}</span>
              <span role="cell" class="rank-muted">{{
                t('rankLog.form.games', { count: row.tally.games })
              }}</span>
              <span role="cell">{{ recordText(row.tally) }}</span>
              <strong role="cell">{{ percent(rankLogWinRate(row.tally)) }}</strong>
            </div>
          </div>
          <div class="rank-hint pt-2">
            {{
              t('rankLog.form.hint', {
                minutes: RANK_LOG_SESSION_GAP_MS / 60_000,
                min: RANK_LOG_MIN_RATE_GAMES
              })
            }}
          </div>
        </NCard>
        <NCard size="small" :title="t('rankLog.days.title')">
          <div class="rank-table days-table" role="table" :aria-label="t('rankLog.days.title')">
            <div class="rank-row day-row rank-header" role="row">
              <span role="columnheader">{{ t('rankLog.days.day') }}</span>
              <span role="columnheader">{{ t('rankLog.days.games') }}</span>
              <span role="columnheader">{{ t('rankLog.days.net') }}</span>
            </div>
            <div v-for="day in summary.days" :key="day.day" class="rank-row day-row" role="row">
              <span role="cell">{{ day.day }}</span>
              <span role="cell">{{ day.tally.games ? recordText(day.tally) : '—' }}</span>
              <strong role="cell" :class="toneOf(day.net)">{{ reviewSigned(day.net) }}</strong>
            </div>
          </div>
          <div class="rank-hint pt-2">
            {{ t('rankLog.days.hint', { hour: RANK_LOG_DAY_START_HOUR }) }}
          </div>
        </NCard>
      </div>

      <NCard size="small" :title="t('rankLog.table.title')">
        <div class="log-list">
          <div v-for="entry in visibleEntries" :key="entry.id" class="log-row">
            <span class="log-time">{{ reviewDate(entry.occurredAt) }}</span>
            <div class="log-main">
              <template v-if="entry.kind === 'game' && entry.gameId !== null">
                <ChampionIcon
                  v-if="entry.championId"
                  :champion-id="entry.championId"
                  class="size-7 shrink-0 rounded"
                />
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-1.5">
                    <span class="font-medium">{{
                      entry.championId
                        ? resources.champions.name(entry.championId)
                        : `#${entry.gameId}`
                    }}</span>
                    <NTag size="tiny" :bordered="false" :type="resultTone(entry)">{{
                      resultText(entry)
                    }}</NTag>
                  </div>
                  <div v-if="gameMeta(entry)" class="log-meta">{{ gameMeta(entry) }}</div>
                </div>
              </template>
              <template v-else>
                <span>{{ noteText(entry) }}</span>
                <NTag
                  v-if="entry.kind === 'game'"
                  size="tiny"
                  :bordered="false"
                  :type="resultTone(entry)"
                  >{{ resultText(entry) }}</NTag
                >
              </template>
            </div>
            <strong
              class="log-lp"
              :class="[toneOf(entry.lpDelta), { 'log-lp-missing': entry.lpDelta === null }]"
              >{{ lpText(entry) }}</strong
            >
            <span class="log-rank">{{ entry.observedAt === null ? '' : rankText(entry) }}</span>
            <NButton
              v-if="entry.gameId !== null"
              size="tiny"
              secondary
              @click="emit('open', entry.gameId)"
              >{{ t('rankLog.table.review') }}</NButton
            >
            <span v-else />
          </div>
        </div>
        <div v-if="queueEntries.length > visibleCount" class="flex justify-center pt-3">
          <NButton size="small" secondary @click="visibleCount += PAGE_SIZE">{{
            t('rankLog.table.more')
          }}</NButton>
        </div>
      </NCard>
      <div class="rank-hint">{{ t('rankLog.note') }}</div>
    </template>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useInstance } from '@renderer-shared/shards'
import { RankLogRenderer } from '@renderer-shared/shards/rank-log'
import { useRankLogStore } from '@renderer-shared/shards/rank-log/store'
import {
  RANK_LOG_QUERY_MAX_LIMIT,
  RANK_LOG_QUEUE_TYPES,
  type RankLogEntryDto,
  type RankLogQueueType,
  type RankLogSyncResult,
  fromAbsoluteLp,
  isApexTier
} from '@shared/shards/rank-log'
import {
  RANK_LOG_DAY_START_HOUR,
  RANK_LOG_MIN_RATE_GAMES,
  RANK_LOG_SESSION_GAP_MS,
  RANK_LOG_TILT_LOSS_STREAK,
  type RankLogTally,
  rankLogDay,
  rankLogWinRate,
  summarizeRankLog
} from '@shared/shards/rank-log/stats'
import {
  Chart as ChartJS,
  type ChartData,
  type ChartOptions,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip
} from 'chart.js'
import dayjs from 'dayjs'
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCard,
  NEmpty,
  NRadioButton,
  NRadioGroup,
  NSwitch,
  NTag,
  NText,
  useThemeVars
} from 'naive-ui'
import { computed, ref, shallowRef, watch } from 'vue'
import { Line } from 'vue-chartjs'

import { normalizeReviewPosition } from './analysis'
import { REVIEW_POSITION_LABELS, reviewClock, reviewDate, reviewSigned } from './review-display'

ChartJS.register(LinearScale, PointElement, LineElement, Tooltip)

const PAGE_SIZE = 40
/** 曲线最多画最近这么多次读数，再多就看不清单局了。 */
const MAX_CHART_POINTS = 400

const props = defineProps<{ puuid: string; sgpServerId: string; active: boolean }>()
const emit = defineEmits<{ open: [gameId: number] }>()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
const { t: tc } = useTranslation()
const theme = useThemeVars()
const resources = useAkariResourceProvider()
const rankLog = useInstance(RankLogRenderer)
const store = useRankLogStore()

const entries = shallowRef<RankLogEntryDto[]>([])
const loaded = ref(false)
const now = ref(Date.now())
const queueType = ref<RankLogQueueType>('RANKED_SOLO_5x5')
const queueTouched = ref(false)
const visibleCount = ref(PAGE_SIZE)
const syncing = ref(false)
const syncMessage = ref<{ type: 'success' | 'info' | 'warning'; text: string } | null>(null)
let loadSequence = 0

async function load() {
  const sequence = ++loadSequence
  try {
    const result =
      props.puuid && props.sgpServerId && store.state.available
        ? await rankLog.queryEntries({
            puuid: props.puuid,
            sgpServerId: props.sgpServerId,
            limit: RANK_LOG_QUERY_MAX_LIMIT
          })
        : []
    if (sequence !== loadSequence) return
    entries.value = result
    now.value = Date.now()
    // 只打灵活排位的人，打开时直接看到灵活排位。
    if (
      !queueTouched.value &&
      !result.some((entry) => entry.queueType === queueType.value && entry.kind === 'game')
    ) {
      const other = RANK_LOG_QUEUE_TYPES.find((type) =>
        result.some((entry) => entry.queueType === type && entry.kind === 'game')
      )
      if (other) queueType.value = other
    }
  } catch {
    // 读取失败时保留上一次的内容，下一次变化会再读。
  } finally {
    if (sequence === loadSequence) loaded.value = true
  }
}
watch(
  () =>
    [
      props.active,
      props.puuid,
      props.sgpServerId,
      store.state.revision,
      store.state.available
    ] as const,
  ([active]) => {
    if (active) void load()
  },
  { immediate: true }
)
watch(
  () => [props.puuid, props.sgpServerId],
  () => {
    entries.value = []
    loaded.value = false
    queueTouched.value = false
    visibleCount.value = PAGE_SIZE
    syncMessage.value = null
  }
)
watch(queueType, () => {
  visibleCount.value = PAGE_SIZE
})

const RESULT_KEYS: Record<NonNullable<RankLogSyncResult['reason']>, string> = {
  disabled: 'disabled',
  unavailable: 'unavailable',
  'not-connected': 'notConnected',
  'rank-unreadable': 'rankUnreadable'
}
async function sync() {
  if (syncing.value) return
  syncing.value = true
  syncMessage.value = null
  try {
    const result = await rankLog.syncNow()
    syncMessage.value =
      result.result === 'ok'
        ? result.historyLoaded
          ? { type: 'success', text: t('rankLog.result.ok') }
          : { type: 'info', text: t('rankLog.result.noHistory') }
        : {
            type: 'warning',
            text: t(`rankLog.result.${RESULT_KEYS[result.reason ?? 'rank-unreadable']}`)
          }
  } catch {
    syncMessage.value = { type: 'warning', text: t('rankLog.result.rankUnreadable') }
  } finally {
    syncing.value = false
    void load()
  }
}

/** Newest first, as the log returns them. */
const queueEntries = computed(() =>
  entries.value.filter((entry) => entry.queueType === queueType.value)
)
const visibleEntries = computed(() => queueEntries.value.slice(0, visibleCount.value))
const summary = computed(() =>
  summarizeRankLog(entries.value, { queueType: queueType.value, now: now.value })
)

const toneColors = computed(() => ({
  '--rank-win': theme.value.successColor,
  '--rank-loss': theme.value.errorColor
}))
const toneOf = (value: number | null | undefined) =>
  value == null || value === 0 ? '' : value > 0 ? 'tone-win' : 'tone-loss'
const percent = (value: number | null) => (value === null ? '—' : `${Math.round(value)}%`)

function rankText(
  entry: Pick<RankLogEntryDto, 'tier' | 'division' | 'leaguePoints' | 'provisional'> | null
) {
  if (!entry?.tier) return t('rankLog.unranked')
  const values = {
    tier: tc(`shortTiers.${entry.tier}`, { ns: 'common' }),
    division: entry.division ?? '',
    lp: entry.leaguePoints ?? 0
  }
  const text = isApexTier(entry.tier) ? t('rankLog.apexRank', values) : t('rankLog.rank', values)
  return entry.provisional ? `${text} · ${t('rankLog.provisional')}` : text
}
const recordText = (tally: RankLogTally) =>
  t('rankLog.record', { wins: tally.wins, losses: tally.losses })
function rateText(tally: RankLogTally) {
  const rate = rankLogWinRate(tally)
  return rate === null
    ? t('rankLog.cards.fewGames')
    : t('rankLog.cards.winRate', { rate: Math.round(rate) })
}
const todayText = computed(() => {
  const today = summary.value.days.find((day) => day.day === rankLogDay(now.value))
  if (!today?.tally.games) return t('rankLog.cards.todayNone')
  const record = recordText(today.tally)
  return today.net === null
    ? t('rankLog.cards.todayNoLp', { record })
    : t('rankLog.cards.today', { record, net: reviewSigned(today.net) })
})

/** 连败熔断：这一段还没结束且已经连败到门槛时提醒，并摆出本人连败后接着打的实际战绩。 */
const tilt = computed(() => {
  const session = summary.value.activeSession
  if (!session || session.lossStreak < RANK_LOG_TILT_LOSS_STREAK) return null
  const after = rankLogWinRate(summary.value.afterLossStreak)
  const other = rankLogWinRate(summary.value.otherGames)
  // 建议跟着本人的记录走：记录显示连败后更差才劝休息，样本不够就照实说看不出来。
  const verdict: 'worse' | 'notWorse' | 'unknown' =
    after === null || other === null ? 'unknown' : after < other ? 'worse' : 'notWorse'
  return {
    count: session.lossStreak,
    verdict,
    values: {
      threshold: RANK_LOG_TILT_LOSS_STREAK,
      min: RANK_LOG_MIN_RATE_GAMES,
      after: Math.round(after ?? 0),
      afterGames: summary.value.afterLossStreak.games,
      other: Math.round(other ?? 0),
      otherGames: summary.value.otherGames.games
    }
  }
})

const formRows = computed(() => {
  const buckets = summary.value.bySessionIndex
  return [
    ...buckets.map((tally, index) => ({
      key: `index-${index}`,
      label: t(`rankLog.form.${index === buckets.length - 1 ? 'indexRest' : 'index'}`, {
        index: index + 1
      }),
      tally,
      emphasized: false
    })),
    {
      key: 'after',
      label: t('rankLog.form.afterLossStreak', { threshold: RANK_LOG_TILT_LOSS_STREAK }),
      tally: summary.value.afterLossStreak,
      emphasized: true
    },
    {
      key: 'other',
      label: t('rankLog.form.otherGames'),
      tally: summary.value.otherGames,
      emphasized: false
    }
  ]
})

function resultText(entry: RankLogEntryDto) {
  if (entry.remake) return t('rankLog.table.remake')
  return t(`rankLog.table.${entry.win ? 'win' : 'loss'}`)
}
function resultTone(entry: RankLogEntryDto) {
  return entry.remake ? 'default' : entry.win ? 'success' : 'error'
}
function gameMeta(entry: RankLogEntryDto) {
  const position = entry.position ? normalizeReviewPosition(entry.position) : 'UNKNOWN'
  return [
    position === 'UNKNOWN' ? '' : REVIEW_POSITION_LABELS[position],
    entry.kills === null || entry.deaths === null || entry.assists === null
      ? ''
      : `${entry.kills}/${entry.deaths}/${entry.assists}`,
    entry.cs === null ? '' : t('rankLog.table.cs', { count: entry.cs }),
    entry.gameDuration === null ? '' : reviewClock(entry.gameDuration * 1000)
  ]
    .filter(Boolean)
    .join(' · ')
}
function noteText(entry: RankLogEntryDto) {
  if (entry.kind === 'gap') return t('rankLog.table.gap', { count: entry.games ?? 0 })
  if (entry.kind === 'adjustment') return t('rankLog.table.adjustment')
  if (entry.kind === 'baseline') return t('rankLog.table.baseline')
  return t('rankLog.table.unidentified')
}
function lpText(entry: RankLogEntryDto) {
  if (entry.lpDelta !== null) return reviewSigned(entry.lpDelta)
  // 只有计入胜负的对局才提示「未记录」；重开、起点本来就没有胜点。
  return entry.kind === 'game' && !entry.remake ? t('rankLog.table.noLp') : ''
}

const chartPoints = computed(() => summary.value.points.slice(-MAX_CHART_POINTS))
function pointText(entry: RankLogEntryDto) {
  if (entry.kind !== 'game') return noteText(entry)
  const name = entry.championId ? resources.champions.name(entry.championId) : ''
  return [name, resultText(entry)].filter(Boolean).join(' · ')
}
const chartData = computed<ChartData<'line', { x: number; y: number }[]>>(() => {
  const colors = chartPoints.value.map(({ entry }) =>
    entry.kind !== 'game' || entry.win === null
      ? theme.value.textColor3
      : entry.win
        ? theme.value.successColor
        : theme.value.errorColor
  )
  return {
    datasets: [
      {
        data: chartPoints.value.map((point, index) => ({ x: index, y: point.absoluteLp })),
        borderColor: theme.value.primaryColor,
        borderWidth: 1.5,
        tension: 0,
        pointBackgroundColor: colors,
        pointBorderColor: colors,
        pointRadius: chartPoints.value.length > 120 ? 2 : 3.5,
        pointHoverRadius: 6,
        pointHitRadius: 8
      }
    ]
  }
})
function axisRank(value: number) {
  const rank = fromAbsoluteLp(value)
  const tier = tc(`shortTiers.${rank.tier}`, { ns: 'common' })
  // 整百的刻度就是小段的起点，只写段位；其余刻度带上段内的胜点。
  return [tier, rank.division, rank.division && !rank.leaguePoints ? '' : rank.leaguePoints]
    .filter((part) => part !== '')
    .join(' ')
}
const chartOptions = computed<ChartOptions<'line'>>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  animation: false,
  parsing: false,
  interaction: { mode: 'nearest', axis: 'x', intersect: false },
  onClick: (_event, elements) => {
    const gameId = chartPoints.value[elements[0]?.index]?.entry.gameId
    if (gameId) emit('open', gameId)
  },
  plugins: {
    datalabels: { display: false },
    legend: { display: false },
    tooltip: {
      displayColors: false,
      callbacks: {
        title: (items) => {
          const entry = chartPoints.value[items[0]?.dataIndex]?.entry
          return entry ? reviewDate(entry.occurredAt) : ''
        },
        label: (item) => {
          const entry = chartPoints.value[item.dataIndex]?.entry
          if (!entry) return ''
          return [
            entry.lpDelta === null
              ? pointText(entry)
              : `${pointText(entry)} · ${reviewSigned(entry.lpDelta)}`,
            rankText(entry)
          ]
        }
      }
    }
  },
  scales: {
    x: {
      type: 'linear',
      min: 0,
      max: Math.max(1, chartPoints.value.length - 1),
      ticks: {
        color: theme.value.textColor3,
        maxTicksLimit: 8,
        precision: 0,
        callback: (value) => {
          const entry = chartPoints.value[Number(value)]?.entry
          return entry ? dayjs(entry.occurredAt).format('MM-DD') : ''
        }
      },
      grid: { display: false }
    },
    y: {
      ticks: {
        color: theme.value.textColor3,
        maxTicksLimit: 7,
        precision: 0,
        callback: (value) => axisRank(Number(value))
      },
      grid: {
        // 每满一百点是一个小段的分界，画得深一些。
        color: (context) =>
          context.tick.value % 100 === 0 ? theme.value.textColor3 : theme.value.dividerColor
      }
    }
  }
}))
</script>

<style scoped>
.rank-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}
.rank-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
}
.rank-hint {
  font-size: 12px;
  opacity: 0.72;
  line-height: 1.7;
}
.rank-muted {
  opacity: 0.6;
}
.rank-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
}
.rank-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  padding: 10px 12px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
  background: rgb(var(--la-card-tint-rgb) / 0.04);
  font-variant-numeric: tabular-nums;
}
.rank-card > strong {
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.rank-label {
  font-size: 11px;
  opacity: 0.65;
}
.rank-separator {
  margin: 0 6px;
  opacity: 0.4;
  font-weight: 400;
}
.tone-win {
  color: var(--rank-win);
}
.tone-loss {
  color: var(--rank-loss);
}
.chart-area {
  height: 240px;
  min-width: 0;
}
.rank-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  align-items: start;
}
.rank-table {
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
  overflow: hidden;
}
.days-table {
  max-height: 300px;
  overflow-y: auto;
}
.rank-row {
  display: grid;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.rank-row:first-child {
  border-top: 0;
}
.form-row {
  grid-template-columns: minmax(130px, 1.6fr) 6em minmax(70px, 1fr) 3.2em;
}
.form-row > strong,
.day-row > strong {
  text-align: right;
}
.form-row.emphasized {
  background: rgb(var(--la-card-tint-rgb) / 0.06);
}
.day-row {
  grid-template-columns: minmax(90px, 1fr) minmax(80px, 1fr) 4.5em;
}
.rank-header {
  position: sticky;
  top: 0;
  background: var(--n-color, var(--la-color-surface));
  font-size: 11px;
  opacity: 0.65;
}
.log-list {
  display: flex;
  flex-direction: column;
}
.log-row {
  display: grid;
  grid-template-columns: 6.5em minmax(160px, 1fr) 6.5em minmax(150px, 0.9fr) 3.6em;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.08);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.log-row:first-child {
  border-top: 0;
}
.log-time {
  opacity: 0.6;
}
.log-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.log-meta {
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.56;
}
.log-lp {
  font-size: 13px;
  font-weight: 600;
  text-align: right;
}
.log-lp-missing {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.5;
}
.log-rank {
  opacity: 0.75;
  overflow-wrap: anywhere;
}
@media (max-width: 760px) {
  .rank-columns {
    grid-template-columns: 1fr;
  }
  .log-row {
    grid-template-columns: 1fr auto;
  }
  .log-main {
    grid-column: 1 / -1;
  }
}
</style>
