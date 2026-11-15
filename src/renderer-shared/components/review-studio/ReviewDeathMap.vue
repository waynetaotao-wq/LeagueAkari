<template>
  <div class="death-view">
    <NEmpty v-if="!matches.length" :description="t('deathMap.empty')" />
    <NEmpty
      v-else-if="!sample.games.length"
      :description="t(sample.legacyGames ? 'deathMap.legacyOnly' : 'deathMap.partialOnly')"
    />
    <template v-else>
      <div>
        <div class="death-title">{{ t('deathMap.title') }}</div>
        <div class="death-hint">{{ t('deathMap.hint') }}</div>
      </div>
      <div class="death-controls">
        <div class="control-field control-wide">
          <span>{{ t('deathMap.time') }} · {{ describeRange(range, 'preset') }}</span>
          <div class="flex flex-wrap gap-1.5">
            <NButton
              v-for="preset in PRESETS"
              :key="preset.join('-')"
              size="tiny"
              :secondary="!isPreset(preset)"
              :type="isPreset(preset) ? 'primary' : 'default'"
              :aria-pressed="isPreset(preset)"
              @click="range = [preset[0], preset[1]]"
              >{{ describeRange(preset, 'preset') }}</NButton
            >
          </div>
          <NSlider
            v-model:value="range"
            range
            :min="0"
            :max="RANGE_MAX"
            :step="1"
            :format-tooltip="sliderTooltip"
            :aria-label="t('deathMap.time')"
          />
        </div>
        <div class="control-field">
          <span>{{ t('deathMap.outcome') }}</span>
          <NSelect v-model:value="outcome" size="small" :options="outcomeOptions" />
        </div>
        <div class="control-field">
          <span>{{ t('deathMap.kind') }}</span>
          <NSelect v-model:value="kind" size="small" :options="kindOptions" />
        </div>
        <div class="control-field">
          <span>{{ t('deathMap.side') }}</span>
          <NSelect v-model:value="side" size="small" :options="sideOptions" />
        </div>
      </div>
      <div class="death-metrics">
        <div class="death-metric">
          <span>{{ t('deathMap.games') }}</span
          ><strong>{{ summary.games }}</strong>
        </div>
        <div class="death-metric">
          <span>{{ t('deathMap.deaths') }}</span
          ><strong>{{ summary.deaths }}</strong>
        </div>
        <div class="death-metric">
          <span>{{ t('deathMap.perGame') }}</span
          ><strong>{{ summary.perGame === null ? '—' : summary.perGame.toFixed(1) }}</strong>
        </div>
        <div class="death-metric">
          <span>{{ t('deathMap.soloShare') }}</span
          ><strong>{{ share(summary.solo, summary.deaths) }}</strong>
        </div>
        <div class="death-metric">
          <span>{{ t('deathMap.jungleShare') }}</span
          ><strong>{{ share(summary.jungle, summary.jungleKnown) }}</strong>
        </div>
      </div>
      <NAlert :type="summary.hotspot ? 'warning' : 'default'" :show-icon="false">
        <template v-if="summary.hotspot"
          >{{
            t('deathMap.hotspot', {
              range: rangeLabel,
              share: reviewPercent(summary.hotspot.share),
              zone: t(`deathMap.zones.${summary.hotspot.zone}`)
            })
          }}
          <span class="death-hint">{{
            t('deathMap.zoneRow', {
              deaths: summary.hotspot.deaths,
              share: reviewPercent(summary.hotspot.share),
              games: summary.hotspot.games
            })
          }}</span></template
        >
        <template v-else>{{
          t(
            summary.located < REVIEW_HOTSPOT_MIN_DEATHS ? 'deathMap.tooFew' : 'deathMap.noHotspot',
            {
              range: rangeLabel
            }
          )
        }}</template>
      </NAlert>
      <div class="death-layout">
        <div class="flex min-w-0 flex-col gap-3">
          <div class="death-map">
            <img :src="map11" :alt="t('deathMap.mapAlt')" class="map-layer" />
            <canvas
              v-show="showHeat"
              ref="heatCanvas"
              class="map-layer map-heat"
              :width="HEAT_SIZE"
              :height="HEAT_SIZE"
              aria-hidden="true"
            />
            <svg
              class="map-layer"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden="true"
            >
              <circle
                v-for="marker in markers"
                :key="marker.entry.key"
                class="map-dot"
                :class="[
                  `dot-${marker.entry.kind}`,
                  { 'dot-dimmed': marker.dimmed, 'dot-selected': marker.entry.key === selectedKey }
                ]"
                :cx="marker.left"
                :cy="marker.top"
                :r="marker.entry.key === selectedKey ? 2.2 : 1.35"
                @click="selectEntry(marker.entry)"
              >
                <title>
                  {{ reviewClock(marker.entry.timestamp) }} · {{ describe(marker.entry) }}
                </title>
              </circle>
            </svg>
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="death-legend">
              <span><i class="legend-dot dot-solo" />{{ t('deathMap.solo') }}</span>
              <span><i class="legend-dot dot-group" />{{ t('deathMap.group') }}</span>
              <span><i class="legend-dot dot-execute" />{{ t('deathMap.execute') }}</span>
            </div>
            <NCheckbox v-model:checked="showHeat">{{ t('deathMap.showHeat') }}</NCheckbox>
          </div>
        </div>
        <div class="flex min-w-0 flex-col gap-4">
          <div class="flex flex-col gap-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <NText strong>{{ t('deathMap.zonesTitle') }}</NText>
              <NButton v-if="selectedZone" size="tiny" secondary @click="selectedZone = null">{{
                t('deathMap.clearZone')
              }}</NButton>
            </div>
            <div class="death-hint">{{ t('deathMap.zonesHint') }}</div>
            <NEmpty
              v-if="!summary.zones.length"
              size="small"
              :description="t('deathMap.listEmpty')"
            />
            <NButton
              v-for="zone in summary.zones.slice(0, 8)"
              :key="zone.zone"
              block
              size="small"
              class="zone-row"
              :secondary="selectedZone === zone.zone"
              :type="selectedZone === zone.zone ? 'primary' : 'default'"
              :aria-pressed="selectedZone === zone.zone"
              @click="selectedZone = selectedZone === zone.zone ? null : zone.zone"
            >
              <div class="zone-content">
                <span class="zone-name">{{ t(`deathMap.zones.${zone.zone}`) }}</span>
                <span class="zone-value">{{
                  t('deathMap.zoneRow', {
                    deaths: zone.deaths,
                    share: reviewPercent(zone.share),
                    games: zone.games
                  })
                }}</span>
                <span class="zone-bar" :style="{ width: `${zone.share * 100}%` }" />
              </div>
            </NButton>
          </div>
          <div class="flex flex-col gap-2">
            <NText strong>{{ t('deathMap.timelineTitle') }}</NText>
            <div class="death-hint">{{ t('deathMap.timelineHint') }}</div>
            <div class="death-bars" aria-hidden="true">
              <div
                v-for="(count, index) in summary.timeline"
                :key="index"
                class="death-bar"
                :class="{ 'bar-active': bucketActive(index) }"
                :title="bucketTitle(index, count)"
              >
                <span :style="{ height: `${timelinePeak ? (count / timelinePeak) * 100 : 0}%` }" />
              </div>
            </div>
            <div class="death-axis" aria-hidden="true">
              <span>0</span><span>10</span><span>20</span><span>30</span><span>40+</span>
            </div>
          </div>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <NText strong
            >{{ t('deathMap.listTitle')
            }}<template v-if="selectedZone">
              · {{ t(`deathMap.zones.${selectedZone}`) }}</template
            ></NText
          >
          <NText depth="3" class="text-xs">{{
            t('deathMap.listCount', { count: listEntries.length })
          }}</NText>
        </div>
        <NEmpty v-if="!listEntries.length" size="small" :description="t('deathMap.listEmpty')" />
        <div
          v-for="entry in pageEntries"
          :key="entry.key"
          class="death-row"
          :class="{ selected: entry.key === selectedKey }"
        >
          <NText strong class="death-time">{{ reviewClock(entry.timestamp) }}</NText>
          <div class="death-detail">
            <div class="flex flex-wrap items-center gap-1.5">
              <ChampionIcon
                v-for="(source, index) in sources(entry)"
                :key="index"
                :champion-id="source.championId"
                class="size-5! shrink-0 rounded"
              />
              <span>{{ describe(entry) }}</span>
              <NTag v-if="entry.zone" size="tiny" :bordered="false">{{
                t(`deathMap.zones.${entry.zone}`)
              }}</NTag>
              <NTag v-else size="tiny" :bordered="false">{{ t('deathMap.noPoint') }}</NTag>
              <NTag v-if="entry.jungle" size="tiny" :bordered="false" type="warning">{{
                t('deathMap.jungleTag')
              }}</NTag>
            </div>
            <div class="death-hint">
              {{ reviewDate(entry.gameCreation) }} ·
              {{
                entry.opponentChampionId
                  ? t('deathMap.versus', {
                      opponent: resources.champions.name(entry.opponentChampionId)
                    })
                  : t('deathMap.unknownOpponent')
              }}
              · {{ t(entry.win ? 'deathMap.win' : 'deathMap.loss') }}
            </div>
          </div>
          <NButton size="small" secondary @click="emit('open', entry.gameId, entry.timestamp)">{{
            t('deathMap.review')
          }}</NButton>
        </div>
        <div v-if="listEntries.length > PAGE_SIZE" class="flex justify-end">
          <NPagination
            v-model:page="page"
            :page-size="PAGE_SIZE"
            :item-count="listEntries.length"
            :page-slot="5"
            size="small"
          />
        </div>
      </div>
      <NAlert v-if="mixedEnvironment" type="info" :show-icon="false">{{ t('mixed') }}</NAlert>
      <div class="death-hint">
        {{ t('deathMap.note') }}
        <template v-if="sample.legacyGames">
          {{ t('deathMap.legacy', { count: sample.legacyGames }) }}</template
        ><template v-if="sample.partialGames">
          {{ t('deathMap.partial', { count: sample.partialGames }) }}</template
        >
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import map11 from '@renderer-shared/components/match-card/map-images/11.png'
import { mapToImagePosition } from '@renderer-shared/components/match-card/utils/game-map'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useTranslation } from 'i18next-vue'
import {
  NAlert,
  NButton,
  NCheckbox,
  NEmpty,
  NPagination,
  NSelect,
  NSlider,
  NTag,
  NText
} from 'naive-ui'
import { computed, onMounted, ref, watch } from 'vue'

import {
  REVIEW_DEATH_BUCKET_MS,
  REVIEW_HOTSPOT_MIN_DEATHS,
  type ReviewDeathEntry,
  type ReviewDeathFilter,
  type ReviewDeathZone,
  buildReviewDeathHeat,
  collectReviewDeaths,
  summarizeReviewDeaths
} from './death-map'
import { reviewClock, reviewDate, reviewPercent } from './review-display'
import type { ReviewDeathSource, ReviewMatch } from './types'

const props = defineProps<{ matches: ReviewMatch[] }>()
const emit = defineEmits<{ open: [gameId: number, timestamp: number] }>()
const resources = useAkariResourceProvider()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })

/** Slider upper end; reaching it means "until the game ends". */
const RANGE_MAX = 40
const PRESETS: Array<[number, number]> = [
  [0, RANGE_MAX],
  [0, 5],
  [5, 10],
  [10, 15],
  [15, 25],
  [25, RANGE_MAX]
]
const PAGE_SIZE = 8
const HEAT_SIZE = 96

const range = ref<[number, number]>([0, RANGE_MAX])
const outcome = ref<ReviewDeathFilter['outcome']>('all')
const kind = ref<ReviewDeathFilter['kind']>('all')
const side = ref<ReviewDeathFilter['side']>('all')
const selectedZone = ref<ReviewDeathZone | null>(null)
const selectedKey = ref<string | null>(null)
const showHeat = ref(true)
const page = ref(1)
const heatCanvas = ref<HTMLCanvasElement | null>(null)

const outcomeOptions = computed(() => [
  { label: t('deathMap.all'), value: 'all' },
  { label: t('deathMap.wins'), value: 'win' },
  { label: t('deathMap.losses'), value: 'loss' }
])
const kindOptions = computed(() => [
  { label: t('deathMap.all'), value: 'all' },
  { label: t('deathMap.solo'), value: 'solo' },
  { label: t('deathMap.group'), value: 'group' },
  { label: t('deathMap.jungle'), value: 'jungle' }
])
const sideOptions = computed(() => [
  { label: t('deathMap.all'), value: 'all' },
  { label: t('deathMap.blue'), value: 'blue' },
  { label: t('deathMap.red'), value: 'red' }
])

const sample = computed(() => collectReviewDeaths(props.matches))
const filter = computed<ReviewDeathFilter>(() => ({
  fromMs: range.value[0] * 60_000,
  toMs: range.value[1] >= RANGE_MAX ? Infinity : range.value[1] * 60_000,
  outcome: outcome.value,
  kind: kind.value,
  side: side.value
}))
const result = computed(() => summarizeReviewDeaths(sample.value, filter.value))
const summary = computed(() => result.value.summary)
const listEntries = computed(() =>
  selectedZone.value
    ? result.value.entries.filter((entry) => entry.zone === selectedZone.value)
    : result.value.entries
)
const pageEntries = computed(() =>
  listEntries.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
)
const markers = computed(() =>
  result.value.entries.flatMap((entry) => {
    if (!entry.point) return []
    const position = mapToImagePosition(entry.point.x, entry.point.y, 100, 100, 11)
    return [
      {
        entry,
        left: position.left,
        top: position.top,
        dimmed: selectedZone.value !== null && entry.zone !== selectedZone.value
      }
    ]
  })
)
const timelinePeak = computed(() => Math.max(0, ...summary.value.timeline))
const mixedEnvironment = computed(
  () =>
    new Set(props.matches.map((match) => match.meta.queueId)).size > 1 ||
    new Set(props.matches.map((match) => match.meta.patch)).size > 1
)
/** `preset` keys are compact labels for controls; `range` keys read naturally inside a sentence. */
function describeRange([from, to]: readonly [number, number], style: 'preset' | 'range') {
  if (from <= 0 && to >= RANGE_MAX) return t(`deathMap.${style}All`)
  if (from <= 0) return t(`deathMap.${style}Until`, { to })
  if (to >= RANGE_MAX) return t(`deathMap.${style}After`, { from })
  return t(`deathMap.${style}Between`, { from, to })
}
const rangeLabel = computed(() => describeRange(range.value, 'range'))
const isPreset = (preset: readonly [number, number]) =>
  preset[0] === range.value[0] && preset[1] === range.value[1]
const sliderTooltip = (minute: number) =>
  minute >= RANGE_MAX ? t('deathMap.sliderEnd') : t('deathMap.sliderMinute', { minute })
const share = (part: number, whole: number) => (whole ? reviewPercent(part / whole) : '—')
const sources = (entry: ReviewDeathEntry): ReviewDeathSource[] =>
  entry.killer ? [entry.killer, ...entry.assists] : entry.assists
function describe(entry: ReviewDeathEntry) {
  if (!entry.killer) return t('deathMap.byExecute')
  const killer = resources.champions.name(entry.killer.championId)
  return entry.assists.length
    ? t('deathMap.byGroup', { killer, count: entry.assists.length })
    : t('deathMap.bySolo', { killer })
}
function bucketActive(index: number) {
  const start = index * REVIEW_DEATH_BUCKET_MS
  const last = index === summary.value.timeline.length - 1
  return (last || start + REVIEW_DEATH_BUCKET_MS > filter.value.fromMs) && start < filter.value.toMs
}
function bucketTitle(index: number, count: number) {
  const from = (index * REVIEW_DEATH_BUCKET_MS) / 60_000
  return index === summary.value.timeline.length - 1
    ? t('deathMap.bucketLast', { from, count })
    : t('deathMap.bucket', { from, to: from + REVIEW_DEATH_BUCKET_MS / 60_000, count })
}
function selectEntry(entry: ReviewDeathEntry) {
  selectedKey.value = entry.key
  if (selectedZone.value && entry.zone !== selectedZone.value) selectedZone.value = null
  const index = listEntries.value.findIndex((value) => value.key === entry.key)
  if (index >= 0) page.value = Math.floor(index / PAGE_SIZE) + 1
}

function drawHeat() {
  const context = heatCanvas.value?.getContext('2d')
  if (!context) return
  const grid = buildReviewDeathHeat(
    listEntries.value.flatMap((entry) => (entry.point ? [entry.point] : [])),
    HEAT_SIZE,
    2.6
  )
  const image = context.createImageData(HEAT_SIZE, HEAT_SIZE)
  for (let index = 0; index < grid.length; index++) {
    const value = grid[index]
    // 零散的死亡只留圆点；只有多次重叠的位置才发光，避免整张地图蒙上一层颜色。
    if (value < 0.1) continue
    image.data[index * 4] = 255
    image.data[index * 4 + 1] = Math.round(196 - 136 * value)
    image.data[index * 4 + 2] = 40
    image.data[index * 4 + 3] = Math.round(255 * Math.min(0.78, 0.85 * value ** 1.4))
  }
  context.putImageData(image, 0, 0)
}

watch(listEntries, () => {
  page.value = 1
  if (selectedKey.value && !listEntries.value.some((entry) => entry.key === selectedKey.value))
    selectedKey.value = null
})
watch(
  () => summary.value.zones,
  (zones) => {
    if (selectedZone.value && !zones.some((zone) => zone.zone === selectedZone.value))
      selectedZone.value = null
  }
)
watch([listEntries, showHeat, heatCanvas], drawHeat, { flush: 'post' })
onMounted(drawHeat)
</script>

<style scoped>
.death-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.death-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}
.death-hint {
  font-size: 12px;
  opacity: 0.75;
  line-height: 1.7;
}
.death-controls {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 14px;
}
.control-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 150px;
}
.control-wide {
  flex: 1;
  min-width: min(100%, 320px);
}
.control-field > span {
  font-size: 11px;
  opacity: 0.6;
}
.death-metrics {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
.death-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 10px;
  padding: 14px 16px;
  background: rgb(var(--la-card-tint-rgb) / 0.035);
}
.death-metric > span {
  font-size: 12px;
  opacity: 0.75;
}
.death-metric strong {
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.death-layout {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 300px), 1fr));
  gap: 20px;
}
/* 地图是固定的深色底图，标记颜色不随主题变化，保证两种主题下都看得清。 */
.death-map,
.death-legend {
  --death-solo: rgb(255 96 96);
  --death-group: rgb(255 178 44);
  --death-execute: rgb(214 222 235);
}
.death-map {
  position: relative;
  width: 100%;
  max-width: 440px;
  aspect-ratio: 1;
  margin: 0 auto;
  border-radius: 6px;
  overflow: hidden;
}
.map-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.map-heat {
  pointer-events: none;
}
.map-dot {
  cursor: pointer;
  stroke: rgb(0 0 0 / 0.75);
  stroke-width: 0.35;
}
.dot-solo {
  fill: var(--death-solo);
  background: var(--death-solo);
}
.dot-group {
  fill: var(--death-group);
  background: var(--death-group);
}
.dot-execute {
  fill: var(--death-execute);
  background: var(--death-execute);
}
.dot-dimmed {
  opacity: 0.18;
}
.dot-selected {
  stroke: white;
  stroke-width: 0.7;
}
.death-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  font-size: 12px;
}
.death-legend > span {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}
.legend-dot {
  display: inline-block;
  width: 9px;
  height: 9px;
  border-radius: 50%;
  border: 1px solid rgb(0 0 0 / 0.55);
}
.zone-row {
  height: auto;
  padding: 7px 10px;
}
.zone-row :deep(.n-button__content) {
  display: block;
  width: 100%;
}
.zone-content {
  position: relative;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding-bottom: 6px;
  text-align: left;
  white-space: normal;
}
.zone-name {
  font-weight: 500;
}
.zone-value {
  font-size: 12px;
  opacity: 0.75;
  font-variant-numeric: tabular-nums;
}
.zone-bar {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 3px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.55;
}
.death-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 72px;
}
.death-bar {
  flex: 1;
  height: 100%;
  display: flex;
  align-items: flex-end;
  border-radius: 2px;
  background: rgb(var(--la-card-tint-rgb) / 0.05);
  opacity: 0.45;
}
.death-bar.bar-active {
  opacity: 1;
}
.death-bar > span {
  display: block;
  width: 100%;
  min-height: 0;
  border-radius: 2px;
  background: var(--la-color-link);
}
.death-axis {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
.death-row {
  display: flex;
  align-items: center;
  gap: 14px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.09);
  border-radius: 6px;
  padding: 10px 12px;
  background: rgb(var(--la-card-tint-rgb) / 0.025);
}
.death-row.selected {
  border-color: var(--la-color-link);
}
.death-time {
  min-width: 44px;
  font-variant-numeric: tabular-nums;
}
.death-detail {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  flex: 1;
  font-size: 13px;
}
@media (max-width: 740px) {
  .death-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .death-row {
    flex-wrap: wrap;
  }
}
</style>
