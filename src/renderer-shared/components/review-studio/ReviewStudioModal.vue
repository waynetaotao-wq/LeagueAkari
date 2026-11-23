<template>
  <NModal
    :show="show"
    preset="card"
    size="small"
    class="review-studio-modal"
    :style="{ width: 'min(1180px, calc(100vw - 32px))', height: 'min(960px, 92vh)' }"
    :bordered="false"
    :mask-closable="false"
    :content-style="{ padding: '0', minHeight: '0', overflow: 'hidden' }"
    @update:show="emit('update:show', $event)"
  >
    <template #header
      ><div class="studio-header">
        <div class="studio-title">
          {{ t('title') }}
          <div class="studio-subtitle">{{ t('subtitle') }}</div>
        </div>
        <NRadioGroup v-model:value="activeTab" size="small" aria-label="复盘工作区">
          <NRadioButton value="match">单局复盘</NRadioButton>
          <NRadioButton value="matchups">对位档案</NRadioButton>
          <NRadioButton value="conversion">领先兑现</NRadioButton>
          <NRadioButton value="deaths">{{ t('tabs.deaths') }}</NRadioButton>
          <NRadioButton value="gap">{{ t('tabs.gap') }}</NRadioButton>
          <NRadioButton v-if="isSelf" value="rank">{{ t('tabs.rank') }}</NRadioButton>
        </NRadioGroup>
      </div></template
    >
    <div class="studio-content">
      <NAlert v-if="!availability.ready && activeTab !== 'rank'" type="info" :show-icon="false"
        >{{ availability.reason }}。已保存在本机的档案仍可查看。</NAlert
      >
      <div v-if="isAnalysisTab" class="studio-context">
        <div class="flex min-w-0 flex-wrap items-center gap-2">
          <NTag size="small" :bordered="false">SGP 战绩与时间线</NTag
          ><span class="studio-muted">{{ contextTitle }}</span>
        </div>
        <span class="studio-muted">本机已积累 {{ archivedMatches.length }} 场</span>
      </div>
      <NCollapse v-if="isAnalysisTab" v-model:expanded-names="expandedControls">
        <NCollapseItem
          name="history"
          :title="`${t('filters')}${candidates.length ? ` · ${matchingCandidates.length} 场候选` : ''}`"
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
            <NButton
              v-if="
                availableMetadata.length &&
                !matchingCandidates.length &&
                filtersNarrowed &&
                !showBroadenOffer
              "
              size="small"
              secondary
              :disabled="busy"
              @click="broadenFilters"
              >{{ t('broaden') }}</NButton
            >
            <div v-if="!availableMetadata.length && !busy" class="studio-muted">
              先读取摘要即可选择实际玩过的英雄和位置。有劫中单记录时会优先选择，也支持其他英雄与位置。
            </div>
          </div>
        </NCollapseItem>
      </NCollapse>
      <div v-if="broadenText && showBroadenOffer" class="broaden-offer">
        <span class="studio-muted">{{ broadenText.hint }}</span
        ><NButton
          size="small"
          secondary
          type="primary"
          :disabled="broadenText.needsClient && !availability.ready"
          @click="applyBroadenOffer"
          >{{ broadenText.action }}</NButton
        >
      </div>

      <div
        v-if="activeTab !== 'rank' && (busy || canceled || progress.failed)"
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
      <NAlert v-if="error && activeTab !== 'rank'" type="warning" :show-icon="false"
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
      <NCollapse v-if="failures.length && activeTab !== 'rank'"
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
      <NAlert v-if="archiveError && activeTab !== 'rank'" type="warning" :show-icon="false"
        ><div class="error-content">
          <span>{{ archiveError }}</span
          ><NButton size="tiny" secondary @click="retryArchive">重试档案</NButton>
        </div></NAlert
      >

      <div class="studio-views">
        <div v-show="activeTab === 'match'">
          <div class="single-view">
            <div v-if="selectableGames.length" class="match-selector">
              <NSelect
                :value="selectedGameId"
                :options="matchOptions"
                filterable
                size="small"
                :disabled="busy || !availability.ready"
                placeholder="选择一场对局，展开地图与关键片段"
                aria-label="选择复盘对局"
                @update:value="openMatch($event)"
              /><NButton
                size="small"
                secondary
                :disabled="busy || !availability.ready"
                @click="readHistory"
                >{{ t(historyReady ? 'refreshList' : 'loadList') }}</NButton
              ><NButton
                v-if="selectedMatch"
                size="small"
                secondary
                :disabled="busy || !availability.ready"
                @click="openMatch(selectedMatch.meta.gameId, true)"
                >重新读取</NButton
              >
            </div>
            <div v-if="progress.phase === 'single'" class="single-loading">
              <NSpin size="medium" /><strong>{{ t('preparing') }}</strong
              ><span class="studio-muted">{{ t('preparingHint') }}</span>
            </div>
            <ReviewMatchView
              v-else-if="selectedMatch"
              :key="`${selectedMatch.meta.sgpServerId}:${selectedMatch.meta.gameId}`"
              :model="selectedMatch"
              :active="show && activeTab === 'match'"
              :focus="matchFocus"
              :archive="baselineArchive"
            />
            <div v-else-if="selectableGames.length" class="recent-games">
              <div class="welcome-title">{{ t('chooseMatch') }}</div>
              <NText depth="3" class="text-xs">{{ t('historyLoaded') }}</NText>
              <NButton
                v-for="game in selectableGames.slice(0, 8)"
                :key="game.gameId"
                block
                class="recent-game"
                :disabled="busy || !availability.ready"
                @click="openMatch(game.gameId)"
              >
                <div class="recent-game-content">
                  <ChampionIcon :champion-id="game.championId" class="size-9! shrink-0 rounded" />
                  <div class="recent-game-copy">
                    <NText strong
                      >{{ resources.champions.name(game.championId) }} ·
                      {{ REVIEW_POSITION_LABELS[game.position] }}</NText
                    ><NText depth="3" class="text-xs"
                      >{{ reviewDate(game.gameCreation) }} ·
                      {{ resources.queues.name(game.queueId) }} · {{ game.patch }}</NText
                    >
                  </div>
                  <NTag size="small" :bordered="false" :type="game.win ? 'success' : 'error'">{{
                    game.win ? '胜利' : '失败'
                  }}</NTag
                  ><span class="studio-muted">回看 ↗</span>
                </div>
              </NButton>
            </div>
            <NEmpty
              v-else
              :description="historyReady ? t('historyEmpty') : t('chooseMatch')"
              class="studio-welcome"
              ><template #extra
                ><NButton
                  v-if="!candidates.length"
                  secondary
                  size="small"
                  :disabled="busy || !availability.ready"
                  @click="readHistory"
                  >{{ t('historyAction') }}</NButton
                ><span v-else class="studio-muted"
                  >从上方选择对局，或在对位档案里点击“复盘此局”。</span
                ></template
              ></NEmpty
            >
          </div>
        </div>
        <div v-show="activeTab === 'matchups'">
          <div v-if="visitedTabs.has('matchups')" class="analysis-view">
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
            />
          </div>
        </div>
        <div v-show="activeTab === 'conversion'">
          <div v-if="visitedTabs.has('conversion')" class="analysis-view">
            <div class="sample-source">
              <NRadioGroup v-model:value="sampleSource" size="small"
                ><NRadioButton value="session">本次分析 {{ currentFiltered.length }}</NRadioButton
                ><NRadioButton value="archive"
                  >本机积累 {{ allFiltered.length }}</NRadioButton
                ></NRadioGroup
              ><span class="studio-muted">{{ sampleDescription }}</span>
            </div>
            <ReviewLeadAnalysis :matches="displayedMatches" @open="openMatch" />
          </div>
        </div>
        <div v-show="activeTab === 'deaths'">
          <div v-if="visitedTabs.has('deaths')" class="analysis-view">
            <div class="sample-source">
              <NRadioGroup v-model:value="sampleSource" size="small"
                ><NRadioButton value="session">本次分析 {{ currentFiltered.length }}</NRadioButton
                ><NRadioButton value="archive"
                  >本机积累 {{ allFiltered.length }}</NRadioButton
                ></NRadioGroup
              ><span class="studio-muted">{{ sampleDescription }}</span>
            </div>
            <ReviewDeathMap :matches="displayedMatches" @open="openDeath" />
          </div>
        </div>
        <div v-show="activeTab === 'gap'">
          <div v-if="visitedTabs.has('gap')" class="analysis-view">
            <div class="sample-source">
              <NRadioGroup v-model:value="sampleSource" size="small"
                ><NRadioButton value="session">本次分析 {{ currentFiltered.length }}</NRadioButton
                ><NRadioButton value="archive"
                  >本机积累 {{ allFiltered.length }}</NRadioButton
                ></NRadioGroup
              ><span class="studio-muted">{{ sampleDescription }}</span>
            </div>
            <ReviewOutcomeGap :matches="displayedMatches" @open="openMatch" />
          </div>
        </div>
        <div v-show="activeTab === 'rank'">
          <ReviewRankLog
            v-if="isSelf && visitedTabs.has('rank')"
            :puuid="puuid"
            :sgp-server-id="sgpServerId"
            :active="show && activeTab === 'rank'"
            @open="openMatch"
          />
        </div>
      </div>
      <div v-if="activeTab !== 'rank'" class="studio-footer">
        <span
          >位置来自时间线快照，无法还原完整走位和技能操作。关键片段用于提示复盘，不自动判责。</span
        ><span>{{ archiveStatusText }}</span>
      </div>
    </div>
  </NModal>
</template>

<script setup lang="ts">
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useTranslation } from 'i18next-vue'
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
  NText,
  NTag
} from 'naive-ui'
import { computed, ref, watch } from 'vue'

import ReviewDeathMap from './ReviewDeathMap.vue'
import ReviewLeadAnalysis from './ReviewLeadAnalysis.vue'
import ReviewMatchView from './ReviewMatchView.vue'
import ReviewMatchups from './ReviewMatchups.vue'
import ReviewOutcomeGap from './ReviewOutcomeGap.vue'
import ReviewRankLog from './ReviewRankLog.vue'
import { MAX_REVIEW_ARCHIVE_GAMES } from './archive'
import { matchesReviewCandidate, type ReviewCandidate } from './data-loader'
import { REVIEW_POSITION_LABELS, reviewDate } from './review-display'
import { getReviewBroadenOffer, getReviewDefaultContext } from './review-selection'
import { filterReviewMatches } from './statistics'
import type { ReviewFilter, ReviewPosition } from './types'
import { useReviewData } from './use-review-data'

type ReviewStudioTab = 'match' | 'matchups' | 'conversion' | 'deaths' | 'gap' | 'rank'

const props = defineProps<{
  show: boolean
  puuid: string
  sgpServerId: string
  initialGameId?: number
  initialChampionId?: number
  initialTab?: ReviewStudioTab
}>()
const emit = defineEmits<{ 'update:show': [show: boolean] }>()
const resources = useAkariResourceProvider()
const { t } = useTranslation(undefined, { keyPrefix: 'reviewStudio' })
const {
  availability,
  candidates,
  historyReady,
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
const activeTab = ref<ReviewStudioTab>(props.initialTab ?? 'match')
const visitedTabs = ref(new Set<ReviewStudioTab>(['match', activeTab.value]))
watch(activeTab, (tab) => visitedTabs.value.add(tab))
/** 跨局分析的四个页签共用上方的筛选和读取进度；单局复盘和上分日志不用。 */
const isAnalysisTab = computed(() => activeTab.value !== 'match' && activeTab.value !== 'rank')
/** 上分日志只记录登录账号本人，查看别人时不出现。 */
const leagueClient = useLeagueClientStore()
const isSelf = computed(() => !!props.puuid && props.puuid === leagueClient.summoner.me?.puuid)
watch(isSelf, (self) => {
  if (!self && activeTab.value === 'rank') activeTab.value = 'match'
})
/** Set when a death record asks the single-match view to open at that moment. */
const matchFocus = ref<{ gameId: number; timestamp: number; token: number } | null>(null)
let focusToken = 0
const expandedControls = ref<string[]>(['history'])
const championId = ref<number | null>(props.initialChampionId ?? null)
const position = ref<ReviewPosition>('MIDDLE')
const opponentChampionId = ref<number | null>(null)
const queueId = ref<number | null>(null)
const patch = ref<string | null>(null)
const limit = ref<20 | 40 | 60>(20)
const sampleSource = ref<'session' | 'archive'>('archive')
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
  [
    ...new Set(
      contextMetadata.value
        .filter((meta) => queueId.value === null || meta.queueId === queueId.value)
        .map((meta) => meta.patch)
    )
  ].map((value) => ({
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
/** 单局里「与平时对比」用的样本：本次分析到的对局加上本机档案，同一局只算一次。 */
const baselineArchive = computed(() => [...matches.value, ...archivedMatches.value])
/** 跨局页签上的「一键放宽」：默认的队列 / 版本筛选挡住了同英雄同位置的其它对局时才出现。 */
const broadenOffer = computed(() =>
  getReviewBroadenOffer(filter.value, candidates.value, [
    ...matches.value,
    ...archivedMatches.value
  ])
)
const broadenText = computed(() => {
  const offer = broadenOffer.value
  if (!offer) return null
  const scope = [
    opponentChampionId.value
      ? t('broadenOffer.versus', { opponent: resources.champions.name(opponentChampionId.value) })
      : '',
    queueId.value ? resources.queues.name(queueId.value) : '',
    patch.value === null ? '' : patch.value || t('broadenOffer.unknownPatch')
  ]
    .filter(Boolean)
    .join(' · ')
  const values = { scope, current: offer.current, total: offer.total }
  return offer.mode === 'analyze'
    ? {
        hint: t('broadenOffer.analyzeHint', values),
        action: t('broadenOffer.analyze', { count: Math.min(offer.total, offer.limit) }),
        needsClient: true
      }
    : {
        hint: t('broadenOffer.showHint', values),
        action: t('broadenOffer.show'),
        needsClient: false
      }
})
const showBroadenOffer = computed(
  () =>
    broadenOffer.value !== null &&
    !busy.value &&
    (activeTab.value === 'deaths' || activeTab.value === 'gap')
)
/** 筛选面板里原有的放宽按钮：没有任何限制时点了也没用，一键放宽已显示时不重复出现。 */
const filtersNarrowed = computed(
  () => opponentChampionId.value !== null || queueId.value !== null || patch.value !== null
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
watch(queueId, () => {
  if (patch.value !== null && !patchOptions.value.some((option) => option.value === patch.value))
    patch.value = patchOptions.value[0]?.value ?? null
})
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
    sampleSource.value = 'archive'
    selectedGameId.value = props.initialGameId ?? null
    matchFocus.value = null
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
  expandedControls.value = []
  await analyze({ ...filter.value }, limit.value)
}
function broadenFilters() {
  filtersTouched.value = true
  opponentChampionId.value = null
  queueId.value = null
  patch.value = null
}
/** 放宽后还有没分析过的历史就直接分析；只是被筛选挡住的本机档案则立即显示。 */
async function applyBroadenOffer() {
  const offer = broadenOffer.value
  if (!offer || busy.value) return
  broadenFilters()
  if (offer.mode === 'show') {
    sampleSource.value = 'archive'
    return
  }
  limit.value = offer.limit
  await analyzeHistory()
}
async function openMatch(gameId: number, refresh = false, focusTimestamp?: number) {
  matchFocus.value =
    focusTimestamp === undefined ? null : { gameId, timestamp: focusTimestamp, token: ++focusToken }
  selectedGameId.value = gameId
  activeTab.value = 'match'
  canceled.value = false
  lastOperation.value = 'single'
  await loadMatch(gameId, refresh)
}
const openDeath = (gameId: number, timestamp: number) => openMatch(gameId, false, timestamp)
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
  width: min(1180px, calc(100vw - 32px));
  height: min(960px, 92vh);
  color: var(--la-color-text-primary);
}
.studio-title {
  font-size: 19px;
  font-weight: 600;
}
.studio-subtitle {
  font-size: 12px;
  font-weight: 400;
  opacity: 0.7;
  margin-top: 3px;
}
.studio-content {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  padding: 18px 24px 20px;
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
  font-size: 12px;
  opacity: 0.72;
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
.broaden-offer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
  padding: 8px 12px;
  background: rgb(var(--la-card-tint-rgb) / 0.04);
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
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
  flex-direction: column;
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
  font-size: 11px;
  opacity: 0.68;
  margin-top: auto;
}
.studio-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 6px 20px 6px 4px;
}
/*
 * 页签增多后，极窄窗口里让页签组自身横向滚动，不撑出弹窗。
 * 按钮的描边和文字行框会比页签组高出 1px：只开横向滚动会连带出现一截竖向滚动条，
 * 所以纵向固定不滚动，并用 1px 内边距（外边距抵消）容纳描边，避免被裁掉。
 */
.studio-header :deep(.n-radio-group) {
  max-width: 100%;
  margin: -1px;
  padding: 1px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}
.studio-views {
  min-width: 0;
}
.recent-games {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.welcome-title {
  font-size: 22px;
  font-weight: 600;
  margin: 12px 0 0;
}
.recent-game {
  height: auto;
  padding: 14px;
  border-radius: 8px;
}
.recent-game :deep(.n-button__content) {
  width: 100%;
  white-space: normal;
}
.recent-game-content {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
}
.recent-game-copy {
  display: flex;
  flex-direction: column;
  gap: 5px;
  flex: 1;
}
.studio-welcome {
  padding: 90px 16px;
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
