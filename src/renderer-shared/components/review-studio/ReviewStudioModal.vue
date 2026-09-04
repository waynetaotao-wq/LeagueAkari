<template>
  <NModal
    :show="show"
    preset="card"
    size="small"
    class="review-studio-modal"
    :bordered="false"
    :mask-closable="false"
    :content-style="{ padding: '0', minHeight: '0', overflow: 'hidden' }"
    @update:show="emit('update:show', $event)"
  >
    <template #header
      ><div class="studio-title">
        对局复盘台
        <div class="studio-subtitle">关键片段 · 时间线地图 · 对位档案 · 领先兑现</div>
      </div></template
    >
    <div class="studio-content">
      <NAlert v-if="!availability.ready" type="info" :show-icon="false"
        >{{ availability.reason }}。已保存在本机的档案仍可查看。</NAlert
      >
      <div class="studio-context">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <NTag size="small" :bordered="false">SGP 战绩与时间线</NTag
          ><span class="studio-muted">{{ contextTitle }}</span>
        </div>
        <span class="studio-muted">本机已积累 {{ archivedMatches.length }} 场</span>
      </div>
      <NCollapse v-model:expanded-names="expandedControls">
        <NCollapseItem
          name="history"
          :title="`历史分析与筛选${candidates.length ? ` · ${candidates.length} 场候选` : ''}`"
        >
          <div class="history-controls">
            <div class="history-intro">
              <div>
                <div class="font-medium">先选对局范围，再读取时间线</div>
                <div class="studio-muted">
                  手动读取最近最多 500 场摘要；只分析你选中的最近 20 / 40 / 60
                  场，不会自动扫描历史。
                </div>
              </div>
              <NButton
                secondary
                size="small"
                :disabled="busy || !availability.ready"
                @click="readHistory"
                >{{ candidates.length ? '刷新历史摘要' : '读取历史摘要' }}</NButton
              >
            </div>
            <div v-if="availableMetadata.length" class="filter-grid">
              <div class="filter-field">
                <span>研究英雄</span
                ><NSelect
                  v-model:value="championId"
                  @update:value="filtersTouched = true"
                  filterable
                  :options="championOptions"
                  size="small"
                  :disabled="busy"
                  placeholder="选择英雄"
                />
              </div>
              <div class="filter-field">
                <span>位置</span
                ><NSelect
                  v-model:value="position"
                  @update:value="filtersTouched = true"
                  :options="positionOptions"
                  size="small"
                  :disabled="busy"
                />
              </div>
              <div class="filter-field">
                <span>对位英雄</span
                ><NSelect
                  v-model:value="opponentChampionId"
                  @update:value="filtersTouched = true"
                  filterable
                  clearable
                  :options="opponentOptions"
                  size="small"
                  :disabled="busy"
                  placeholder="全部对位"
                />
              </div>
              <div class="filter-field">
                <span>队列</span
                ><NSelect
                  v-model:value="queueId"
                  @update:value="filtersTouched = true"
                  clearable
                  :options="queueOptions"
                  size="small"
                  :disabled="busy"
                  placeholder="全部队列"
                />
              </div>
              <div class="filter-field">
                <span>版本</span
                ><NSelect
                  v-model:value="patch"
                  @update:value="filtersTouched = true"
                  clearable
                  :options="patchOptions"
                  size="small"
                  :disabled="busy"
                  placeholder="全部版本"
                />
              </div>
              <div class="filter-field">
                <span>本次分析数量</span
                ><NSelect
                  v-model:value="limit"
                  :options="limitOptions"
                  size="small"
                  :disabled="busy"
                />
              </div>
            </div>
            <div v-if="availableMetadata.length" class="analysis-actions">
              <span class="studio-muted"
                >已读取的摘要中有 {{ matchingCandidates.length }} 场符合筛选<template
                  v-if="matchingCandidates.length > limit"
                  >，将取最近 {{ limit }} 场</template
                >。</span
              ><NButton
                type="primary"
                size="small"
                :disabled="busy || !availability.ready || !matchingCandidates.length || !championId"
                @click="analyzeHistory"
                >分析最近 {{ Math.min(limit, matchingCandidates.length) }} 场</NButton
              >
            </div>
            <div v-if="availableMetadata.length" class="studio-muted">
              默认使用有记录的单双排和该队列最近版本；可手动放宽。选择全部队列或全部版本时，结果会混合这些环境，请谨慎比较。
            </div>
            <div v-if="!availableMetadata.length && !busy" class="studio-muted">
              先读取摘要即可选择实际玩过的英雄和位置。有劫中单记录时会优先选择，也支持其他英雄与位置。
            </div>
          </div>
        </NCollapseItem>
      </NCollapse>

      <div
        v-if="busy || progress.attempted || progress.scanned || canceled"
        class="load-progress"
        role="status"
        aria-live="polite"
      >
        <div class="progress-heading">
          <span>{{ progressTitle }}</span
          ><NButton v-if="busy" size="tiny" secondary @click="stopLoading">取消读取</NButton
          ><NButton
            v-else-if="canceled && lastOperation === 'timelines'"
            size="tiny"
            secondary
            :disabled="!availability.ready"
            @click="resumeBatch"
            >继续未完成对局</NButton
          >
        </div>
        <NProgress
          v-if="busy"
          type="line"
          :percentage="progressPercentage"
          :show-indicator="false"
        />
        <div class="studio-muted">{{ progressDetail }}</div>
        <div v-if="progress.truncated" class="studio-muted">
          本次仅覆盖已读取或所选数量的对局，不是该玩家的全部历史。
        </div>
      </div>
      <NAlert v-if="error" type="warning" :show-icon="false"
        ><div class="error-content">
          <span>{{ error }}</span
          ><NButton
            v-if="activeTab === 'match' && selectedGameId"
            size="tiny"
            secondary
            :disabled="busy || !availability.ready"
            @click="openMatch(selectedGameId, true)"
            >重试此局</NButton
          ><NButton
            v-else
            size="tiny"
            secondary
            :disabled="busy || !availability.ready"
            @click="readHistory"
            >重试读取摘要</NButton
          >
        </div></NAlert
      >
      <NCollapse v-if="failures.length"
        ><NCollapseItem :title="`${failures.length} 场未能分析 · 已从统计排除`" name="failures"
          ><div class="failure-list">
            <div v-for="failure in failures" :key="failure.gameId" class="studio-muted">
              对局 {{ failure.gameId }} · {{ failure.reason }}
            </div>
            <NButton
              size="small"
              secondary
              :disabled="busy || !availability.ready"
              @click="resumeBatch"
              >重试未完成对局</NButton
            >
          </div></NCollapseItem
        ></NCollapse
      >
      <NAlert v-if="archiveError" type="warning" :show-icon="false"
        ><div class="error-content">
          <span>{{ archiveError }}</span
          ><NButton size="tiny" secondary @click="retryArchive">重试档案</NButton>
        </div></NAlert
      >

      <NTabs
        v-model:value="activeTab"
        type="line"
        size="medium"
        :animated="false"
        :theme-overrides="{ tabGapMediumLine: '22px' }"
      >
        <NTabPane name="match" tab="单局复盘" display-directive="show:lazy">
          <div class="single-view">
            <div v-if="selectableGames.length" class="match-selector">
              <NSelect
                :value="selectedGameId"
                :options="matchOptions"
                filterable
                size="small"
                :disabled="busy"
                placeholder="选择一场对局，展开地图与关键片段"
                @update:value="openMatch"
              /><NButton
                v-if="selectedMatch"
                size="small"
                secondary
                :disabled="busy || !availability.ready"
                @click="openMatch(selectedMatch.meta.gameId, true)"
                >重新读取</NButton
              >
            </div>
            <div v-if="progress.phase === 'single'" class="single-loading">
              <NSpin size="small" /><span class="studio-muted"
                >正在核对摘要并读取这场对局的时间线…</span
              >
            </div>
            <ReviewMatchView
              v-else-if="selectedMatch"
              :key="`${selectedMatch.meta.sgpServerId}:${selectedMatch.meta.gameId}`"
              :model="selectedMatch"
              :active="show && activeTab === 'match'"
            />
            <NEmpty v-else description="选择一场对局，定位值得复盘的片段"
              ><template #extra
                ><NButton
                  v-if="!candidates.length"
                  secondary
                  size="small"
                  :disabled="busy || !availability.ready"
                  @click="readHistory"
                  >读取历史对局</NButton
                ><span v-else class="studio-muted"
                  >从上方选择对局，或在对位档案里点击“复盘此局”。</span
                ></template
              ></NEmpty
            >
          </div>
        </NTabPane>
        <NTabPane name="matchups" tab="对位档案" display-directive="show:lazy"
          ><div class="analysis-view">
            <div class="sample-source">
              <NRadioGroup v-model:value="sampleSource" size="small"
                ><NRadioButton value="session">本次分析 {{ currentFiltered.length }}</NRadioButton
                ><NRadioButton value="archive"
                  >本机积累 {{ allFiltered.length }}</NRadioButton
                ></NRadioGroup
              ><span class="studio-muted">{{ sampleDescription }}</span>
            </div>
            <ReviewMatchups
              :matches="displayedMatches"
              :puuid="puuid"
              :sgp-server-id="sgpServerId"
              @open="openMatch"
            /></div
        ></NTabPane>
        <NTabPane name="conversion" tab="领先兑现" display-directive="show:lazy"
          ><div class="analysis-view">
            <div class="sample-source">
              <NRadioGroup v-model:value="sampleSource" size="small"
                ><NRadioButton value="session">本次分析 {{ currentFiltered.length }}</NRadioButton
                ><NRadioButton value="archive"
                  >本机积累 {{ allFiltered.length }}</NRadioButton
                ></NRadioGroup
              ><span class="studio-muted">{{ sampleDescription }}</span>
            </div>
            <ReviewLeadAnalysis :matches="displayedMatches" @open="openMatch" /></div
        ></NTabPane>
      </NTabs>
      <div class="studio-footer">
        <span
          >位置来自时间线快照，无法还原完整走位和技能操作。关键片段用于提示复盘，不自动判责。</span
        ><span>{{ archiveStatusText }}</span>
      </div>
    </div>
  </NModal>
</template>

<script setup lang="ts">
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import {
  NAlert,
  NButton,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NModal,
  NProgress,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NSpin,
  NTabPane,
  NTabs,
  NTag
} from 'naive-ui'
import { computed, ref, watch } from 'vue'

import ReviewLeadAnalysis from './ReviewLeadAnalysis.vue'
import ReviewMatchView from './ReviewMatchView.vue'
import ReviewMatchups from './ReviewMatchups.vue'
import { MAX_REVIEW_ARCHIVE_GAMES } from './archive'
import { matchesReviewCandidate, type ReviewCandidate } from './data-loader'
import { REVIEW_POSITION_LABELS, reviewDate } from './review-display'
import { getReviewDefaultContext } from './review-selection'
import { filterReviewMatches } from './statistics'
import type { ReviewFilter, ReviewPosition } from './types'
import { useReviewData } from './use-review-data'

const props = defineProps<{
  show: boolean
  puuid: string
  sgpServerId: string
  initialGameId?: number
  initialChampionId?: number
}>()
const emit = defineEmits<{ 'update:show': [show: boolean] }>()
const resources = useAkariResourceProvider()
const {
  availability,
  candidates,
  matches,
  selectedMatch,
  archivedMatches,
  archiveStatus,
  archiveError,
  progress,
  failures,
  error,
  busy,
  scanHistory,
  analyze,
  loadMatch,
  retryFailed,
  retryArchive,
  cancel
} = useReviewData({
  puuid: () => props.puuid,
  sgpServerId: () => props.sgpServerId,
  active: () => props.show
})
const activeTab = ref('match')
const expandedControls = ref<string[]>(props.initialGameId ? [] : ['history'])
const championId = ref<number | null>(props.initialChampionId ?? null)
const position = ref<ReviewPosition>('MIDDLE')
const opponentChampionId = ref<number | null>(null)
const queueId = ref<number | null>(null)
const patch = ref<string | null>(null)
const limit = ref<20 | 40 | 60>(20)
const sampleSource = ref<'session' | 'archive'>('session')
const selectedGameId = ref<number | null>(props.initialGameId ?? null)
const canceled = ref(false)
const filtersTouched = ref(false)
const lastOperation = ref<'history' | 'timelines' | 'single'>('history')
let initialRequestKey = ''
const limitOptions = [20, 40, 60].map((value) => ({ label: `最近 ${value} 场`, value }))
const filter = computed<ReviewFilter>(() => ({
  championId: championId.value,
  position: position.value,
  opponentChampionId: opponentChampionId.value,
  queueId: queueId.value,
  patch: patch.value
}))
const availableMetadata = computed<ReviewCandidate[]>(() => {
  const records = new Map<number, ReviewCandidate>()
  for (const match of archivedMatches.value) records.set(match.meta.gameId, match.meta)
  for (const candidate of candidates.value) records.set(candidate.gameId, candidate)
  return [...records.values()].sort(
    (a, b) => b.gameCreation - a.gameCreation || b.gameId - a.gameId
  )
})
const championOptions = computed(() =>
  [...new Set(availableMetadata.value.map((meta) => meta.championId))].map((value) => ({
    label: resources.champions.name(value),
    value
  }))
)
const heroMetadata = computed(() =>
  availableMetadata.value.filter((meta) => meta.championId === championId.value)
)
const positionOptions = computed(() =>
  [...new Set(heroMetadata.value.map((meta) => meta.position))].map((value) => ({
    label: REVIEW_POSITION_LABELS[value],
    value
  }))
)
const contextMetadata = computed(() =>
  heroMetadata.value.filter((meta) => meta.position === position.value)
)
const opponentOptions = computed(() =>
  [
    ...new Set(
      contextMetadata.value
        .map((meta) => meta.opponentChampionId)
        .filter((id): id is number => id !== null)
    )
  ].map((value) => ({ label: resources.champions.name(value), value }))
)
const queueOptions = computed(() =>
  [...new Set(contextMetadata.value.map((meta) => meta.queueId))].map((value) => ({
    label: resources.queues.name(value),
    value
  }))
)
const patchOptions = computed(() =>
  [...new Set(contextMetadata.value.map((meta) => meta.patch))].map((value) => ({
    label: value || '版本未知',
    value
  }))
)
const matchingCandidates = computed(() =>
  candidates.value.filter((meta) => matchesReviewCandidate(meta, filter.value))
)
const currentFiltered = computed(() =>
  championId.value ? filterReviewMatches(matches.value, filter.value) : []
)
const allFiltered = computed(() =>
  championId.value
    ? filterReviewMatches([...matches.value, ...archivedMatches.value], filter.value).sort(
        (a, b) => b.meta.gameCreation - a.meta.gameCreation || b.meta.gameId - a.meta.gameId
      )
    : []
)
const displayedMatches = computed(() =>
  sampleSource.value === 'archive' ? allFiltered.value : currentFiltered.value
)
const selectableGames = computed(() => {
  const records = new Map(availableMetadata.value.map((meta) => [meta.gameId, meta]))
  if (selectedMatch.value) records.set(selectedMatch.value.meta.gameId, selectedMatch.value.meta)
  return [...records.values()].sort(
    (a, b) => b.gameCreation - a.gameCreation || b.gameId - a.gameId
  )
})
const matchOptions = computed(() =>
  selectableGames.value.map((meta) => ({
    value: meta.gameId,
    label: `${reviewDate(meta.gameCreation)} · ${resources.champions.name(meta.championId)} / ${REVIEW_POSITION_LABELS[meta.position]} · ${meta.win ? '胜' : '负'} · ${meta.gameId}`
  }))
)
const contextTitle = computed(() =>
  championId.value
    ? `${resources.champions.name(championId.value)} · ${REVIEW_POSITION_LABELS[position.value]}${opponentChampionId.value ? ` · 对 ${resources.champions.name(opponentChampionId.value)}` : ''} · ${patch.value || '全部版本'} · ${queueId.value ? resources.queues.name(queueId.value) : '全部队列'}`
    : '选择英雄和位置，建立可回溯的训练档案'
)
const sampleDescription = computed(() => {
  const values = displayedMatches.value
  if (!values.length) return '当前筛选暂无有效样本；可展开上方筛选，读取并分析历史。'
  const dates = values.map((match) => match.meta.gameCreation).filter((value) => value > 0)
  return `${values.length} 场 · ${dates.length ? `${reviewDate(Math.min(...dates))} 至 ${reviewDate(Math.max(...dates))} · ` : ''}${sampleSource.value === 'archive' ? `来自历次分析的本机留存（最多最近 ${MAX_REVIEW_ARCHIVE_GAMES} 场），非完整战绩；查看地图时重新读取时间线` : '仅本次成功取得且符合当前筛选的对局'}`
})
const archiveStatusText = computed(
  () =>
    ({
      idle: '档案仅保存在本机',
      loading: '正在读取本机档案',
      saving: '正在保存本机档案',
      saved: '本机档案已保存',
      error: '本机档案读写未完成'
    })[archiveStatus.value]
)
const progressPercentage = computed(() =>
  progress.value.target
    ? Math.min(
        100,
        (100 *
          (progress.value.phase === 'history'
            ? progress.value.scanned
            : progress.value.attempted)) /
          progress.value.target
      )
    : 0
)
const progressTitle = computed(() =>
  canceled.value
    ? '已取消，已取得的结果仍可查看'
    : progress.value.phase === 'history'
      ? '正在读取历史摘要'
      : progress.value.phase === 'timelines'
        ? '正在分析时间线'
        : progress.value.phase === 'single'
          ? '正在读取单局复盘'
          : '读取结果'
)
const progressDetail = computed(() =>
  (progress.value.phase === 'idle' ? lastOperation.value : progress.value.phase) === 'history'
    ? `已扫描 ${progress.value.scanned} 场摘要，${candidates.value.length} 场符合基础条件，排除 ${progress.value.skipped} 场。`
    : `已扫描 ${progress.value.scanned} 场摘要；本轮尝试 ${progress.value.attempted} / ${progress.value.target} 场时间线，成功 ${progress.value.succeeded} 场，失败 ${progress.value.failed} 场。`
)

watch(
  availableMetadata,
  (values) => {
    if (!values.length) return
    if (!filtersTouched.value || !values.some((meta) => meta.championId === championId.value)) {
      const preferred = getReviewDefaultContext(values, props.initialChampionId)
      if (!preferred) return
      championId.value = preferred.championId
      position.value = preferred.position
      queueId.value = preferred.queueId
      patch.value = preferred.patch
    }
  },
  { immediate: true }
)
function resetContextFilters() {
  opponentChampionId.value = null
  const selected = getReviewDefaultContext(
    availableMetadata.value,
    championId.value,
    position.value
  )
  queueId.value = selected?.queueId ?? null
  patch.value = selected?.patch ?? null
}
watch(championId, () => {
  const values = heroMetadata.value
  if (values.length && !values.some((meta) => meta.position === position.value))
    position.value = values.some((meta) => meta.position === 'MIDDLE')
      ? 'MIDDLE'
      : values[0].position
  resetContextFilters()
})
watch(position, resetContextFilters)
watch(
  () => props.initialChampionId,
  (value) => {
    filtersTouched.value = false
    const preferred = getReviewDefaultContext(availableMetadata.value, value)
    championId.value = preferred?.championId ?? value ?? null
    position.value = preferred?.position ?? 'MIDDLE'
    resetContextFilters()
  }
)
watch(
  () => [props.puuid, props.sgpServerId],
  () => {
    championId.value = props.initialChampionId ?? null
    position.value = 'MIDDLE'
    opponentChampionId.value = null
    queueId.value = null
    patch.value = null
    sampleSource.value = 'session'
    selectedGameId.value = props.initialGameId ?? null
    filtersTouched.value = false
    lastOperation.value = 'history'
    canceled.value = false
    initialRequestKey = ''
  }
)
watch(
  () => [props.show, props.puuid, props.sgpServerId, props.initialGameId, availability.value.ready],
  () => {
    if (!props.show) {
      initialRequestKey = ''
      return
    }
    if (!props.initialGameId || !availability.value.ready) return
    const key = `${props.puuid}:${props.sgpServerId}:${props.initialGameId}`
    if (initialRequestKey === key) return
    initialRequestKey = key
    if (selectedMatch.value?.meta.gameId === props.initialGameId) {
      activeTab.value = 'match'
      return
    }
    void openMatch(props.initialGameId)
  },
  { immediate: true }
)

async function readHistory() {
  canceled.value = false
  expandedControls.value = ['history']
  lastOperation.value = 'history'
  await scanHistory()
}
async function analyzeHistory() {
  canceled.value = false
  lastOperation.value = 'timelines'
  sampleSource.value = 'session'
  if (activeTab.value === 'match') activeTab.value = 'matchups'
  await analyze({ ...filter.value }, limit.value)
}
async function openMatch(gameId: number, refresh = false) {
  selectedGameId.value = gameId
  activeTab.value = 'match'
  canceled.value = false
  lastOperation.value = 'single'
  await loadMatch(gameId, refresh)
}
function stopLoading() {
  canceled.value = true
  cancel()
}
async function resumeBatch() {
  canceled.value = false
  lastOperation.value = 'timelines'
  await retryFailed()
}
</script>

<style scoped>
.review-studio-modal {
  width: min(1120px, calc(100vw - 32px));
  height: min(920px, 88vh);
  color: var(--la-color-text-primary);
}
.studio-title {
  font-size: 17px;
  font-weight: 600;
}
.studio-subtitle {
  font-size: 11px;
  font-weight: 400;
  opacity: 0.55;
  margin-top: 3px;
}
.studio-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  padding: 16px 20px 18px;
  overflow: auto;
  box-sizing: border-box;
}
.studio-content > * {
  flex-shrink: 0;
}
.studio-context,
.history-intro,
.analysis-actions,
.progress-heading,
.sample-source,
.error-content {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.studio-muted {
  font-size: 11px;
  opacity: 0.6;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.history-controls {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 4px 0 2px;
}
.filter-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px 12px;
}
.filter-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
}
.filter-field > span {
  font-size: 11px;
  opacity: 0.65;
}
.load-progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: rgb(var(--la-card-tint-rgb) / 0.04);
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
}
.progress-heading {
  font-size: 12px;
}
.failure-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow: auto;
  align-items: flex-start;
}
.single-view,
.analysis-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
}
.match-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}
.match-selector :deep(.n-select) {
  flex: 1;
  min-width: 0;
}
.single-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 70px 0;
}
.sample-source {
  align-items: flex-start;
  padding-bottom: 10px;
  border-bottom: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
}
.sample-source > .studio-muted {
  flex: 1;
  min-width: 200px;
}
.studio-footer {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  border-top: 1px solid rgb(var(--la-card-border-rgb) / 0.09);
  padding-top: 10px;
  font-size: 10px;
  opacity: 0.5;
  margin-top: auto;
}
@media (max-width: 720px) {
  .filter-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .studio-content {
    padding: 12px;
  }
}
@media (max-width: 440px) {
  .review-studio-modal {
    width: calc(100vw - 16px);
    height: 90vh;
  }
  .filter-grid {
    grid-template-columns: 1fr;
  }
  .studio-context {
    align-items: flex-start;
  }
}
</style>
