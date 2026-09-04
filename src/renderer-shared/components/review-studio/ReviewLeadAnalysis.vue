<template>
  <div class="lead-view">
    <div class="lead-heading">
      <div>
        <div class="lead-title">领先之后，发生了什么</div>
        <div class="lead-hint">
          筛选固定时间点已经领先的对局，回看后续经济快照、个人死亡和敌方目标事件。
        </div>
      </div>
    </div>
    <div class="lead-controls">
      <div class="control-field">
        <span>观察时间点</span
        ><NRadioGroup v-model:value="checkpoint" size="small"
          ><NRadioButton :value="10">10 分钟</NRadioButton
          ><NRadioButton :value="15">15 分钟</NRadioButton></NRadioGroup
        >
      </div>
      <div class="control-field">
        <span>领先口径</span><NSelect v-model:value="scope" :options="scopeOptions" size="small" />
      </div>
    </div>
    <div class="lead-metrics">
      <div class="lead-metric">
        <span>可判断样本</span
        ><strong
          >{{ allStats.eligibleGames }}<small> / {{ matches.length }}</small></strong
        >
      </div>
      <div class="lead-metric">
        <span>达到领先门槛</span><strong>{{ allStats.games }}</strong>
      </div>
      <div class="lead-metric">
        <span>领先后胜 / 负</span
        ><strong
          >{{ allStats.wins }}<small> / {{ allStats.games - allStats.wins }}</small></strong
        >
      </div>
      <div class="lead-metric">
        <span>这些领先对局的胜率</span><strong>{{ reviewPercent(allStats.winRate) }}</strong>
      </div>
    </div>
    <div class="lead-hint">
      {{ checkpoint }} 分钟{{
        scope === 'personal'
          ? `对位经济领先至少 ${REVIEW_PERSONAL_LEAD_GOLD}`
          : `团队总经济领先至少 ${REVIEW_TEAM_LEAD_GOLD}`
      }}；{{ allStats.excludedGames }}
      场缺少适用快照，未纳入判断。此处描述已选样本，不代表个人能力或因果关系。
    </div>
    <div class="lead-results-heading">
      <NRadioGroup v-model:value="outcome" size="small"
        ><NRadioButton value="all">全部领先 {{ allStats.games }}</NRadioButton
        ><NRadioButton value="loss">领先后输 {{ allStats.games - allStats.wins }}</NRadioButton
        ><NRadioButton value="win">领先后赢 {{ allStats.wins }}</NRadioButton></NRadioGroup
      ><NTag
        v-if="allStats.games > 0 && allStats.games < 10"
        type="warning"
        size="small"
        :bordered="false"
        >少量样本</NTag
      >
    </div>
    <NEmpty
      v-if="!stats.entries.length"
      size="small"
      :description="
        matches.length
          ? '当前时间点、领先口径和结果筛选没有匹配对局'
          : '先分析历史对局，再查看领先兑现情况'
      "
    />
    <NCollapse v-else accordion>
      <NCollapseItem
        v-for="entry in visibleEntries"
        :key="entry.match.meta.gameId"
        :name="entry.match.meta.gameId"
      >
        <template #header
          ><div class="lead-entry-heading">
            <ChampionIcon
              :champion-id="entry.match.meta.championId"
              class="size-7 shrink-0 rounded"
            />
            <div class="lead-entry-name">
              <span
                >{{ resources.champions.name(entry.match.meta.championId) }} 对
                {{
                  entry.match.meta.opponentChampionId
                    ? resources.champions.name(entry.match.meta.opponentChampionId)
                    : '对位未知'
                }}</span
              ><span class="lead-hint"
                >{{ reviewDate(entry.match.meta.gameCreation) }} ·
                {{ entry.match.meta.patch }}</span
              >
            </div>
            <NTag
              :type="entry.match.meta.win ? 'success' : 'error'"
              :bordered="false"
              size="small"
              >{{ entry.match.meta.win ? '领先后胜利' : '领先后失利' }}</NTag
            >
          </div></template
        >
        <div class="lead-entry-body">
          <div class="checkpoint-grid">
            <div v-for="snapshot in entry.snapshots" :key="snapshot.minute" class="checkpoint-card">
              <div class="checkpoint-title">
                {{ snapshot.minute }} 分钟<span v-if="snapshot.timestamp !== null" class="lead-hint"
                  >{{ reviewClock(snapshot.timestamp) }} 快照</span
                >
              </div>
              <div class="checkpoint-value">
                <span>对位经济差</span
                ><strong>{{ reviewSigned(snapshot.personalGoldDiff) }}</strong>
              </div>
              <div class="checkpoint-value">
                <span>团队经济差</span><strong>{{ reviewSigned(snapshot.teamGoldDiff) }}</strong>
              </div>
              <div class="checkpoint-value">
                <span>对位补刀差</span><strong>{{ reviewSigned(snapshot.personalCsDiff) }}</strong>
              </div>
            </div>
          </div>
          <div class="lead-hint">
            {{ entry.checkpoint }} 分钟之后：已记录本人死亡
            {{ entry.deaths.length }} 次，敌方目标事件
            {{ entry.enemyObjectives.length }} 次。<template
              v-if="entry.match.quality.eventCoverage === 'partial'"
              >事件记录不完整，次数仅覆盖已取得部分。</template
            >
          </div>
          <NCollapse
            ><NCollapseItem
              :title="`后续事件 · ${entry.deaths.length + entry.enemyObjectives.length} 条`"
              name="events"
            >
              <NEmpty
                v-if="!entry.deaths.length && !entry.enemyObjectives.length"
                size="small"
                description="已取得的事件里没有这些记录"
              />
              <div v-else class="event-list">
                <div v-for="event in subsequentEvents(entry)" :key="event.id" class="event-row">
                  <span class="event-time">{{ reviewClock(event.timestamp) }}</span
                  ><NTag
                    size="tiny"
                    :bordered="false"
                    :type="event.type === 'kill' ? 'error' : 'warning'"
                    >{{ event.type === 'kill' ? '本人死亡' : '敌方目标' }}</NTag
                  ><span>{{
                    reviewEventText(
                      event,
                      entry.match.participants,
                      resources.champions.name,
                      entry.match.meta.teamId
                    )
                  }}</span
                  ><span
                    v-if="event.shutdownBounty !== null && event.shutdownBounty > 0"
                    class="lead-hint"
                    >终结赏金 {{ event.shutdownBounty }}</span
                  >
                </div>
              </div>
            </NCollapseItem></NCollapse
          >
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="lead-hint"
              >事件的先后顺序不能证明失利原因。打开单局查看完整曲线和地图证据。</span
            ><NButton
              secondary
              type="primary"
              size="small"
              @click="emit('open', entry.match.meta.gameId)"
              >展开单局复盘</NButton
            >
          </div>
        </div>
      </NCollapseItem>
    </NCollapse>
    <div v-if="stats.entries.length > PAGE_SIZE" class="flex justify-end">
      <NPagination
        v-model:page="page"
        :page-size="PAGE_SIZE"
        :item-count="stats.entries.length"
        size="small"
        :page-slot="5"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import {
  NButton,
  NCollapse,
  NCollapseItem,
  NEmpty,
  NPagination,
  NRadioButton,
  NRadioGroup,
  NSelect,
  NTag
} from 'naive-ui'
import { computed, ref, watch } from 'vue'

import { reviewClock, reviewDate, reviewPercent, reviewSigned } from './review-display'
import { reviewEventText } from './review-view-utils'
import {
  REVIEW_PERSONAL_LEAD_GOLD,
  REVIEW_TEAM_LEAD_GOLD,
  analyzeLeadConversion
} from './statistics'
import type { ReviewConversionEntry, ReviewMatch } from './types'

const props = defineProps<{ matches: ReviewMatch[] }>()
const emit = defineEmits<{ open: [gameId: number] }>()
const resources = useAkariResourceProvider()
const checkpoint = ref<10 | 15>(10)
const scope = ref<'personal' | 'team'>('personal')
const outcome = ref<'all' | 'win' | 'loss'>('all')
const page = ref(1)
const PAGE_SIZE = 8
const scopeOptions = [
  { label: `个人对位领先 ≥ ${REVIEW_PERSONAL_LEAD_GOLD} 金币`, value: 'personal' },
  { label: `团队经济领先 ≥ ${REVIEW_TEAM_LEAD_GOLD} 金币`, value: 'team' }
]
const allStats = computed(() =>
  analyzeLeadConversion(props.matches, { checkpoint: checkpoint.value, scope: scope.value })
)
const stats = computed(() =>
  analyzeLeadConversion(props.matches, {
    checkpoint: checkpoint.value,
    scope: scope.value,
    outcome: outcome.value
  })
)
const visibleEntries = computed(() =>
  stats.value.entries.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
)
watch(stats, () => {
  page.value = 1
})
const subsequentEvents = (entry: ReviewConversionEntry) =>
  [...entry.deaths, ...entry.enemyObjectives].sort(
    (a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id)
  )
</script>

<style scoped>
.lead-view {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.lead-heading,
.lead-results-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-wrap: wrap;
}
.lead-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}
.lead-hint {
  font-size: 11px;
  opacity: 0.6;
  line-height: 1.7;
}
.lead-controls {
  display: flex;
  align-items: end;
  flex-wrap: wrap;
  gap: 14px;
}
.control-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 180px;
}
.control-field > span {
  font-size: 11px;
  opacity: 0.6;
}
.lead-metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.lead-metric {
  display: flex;
  flex-direction: column;
  gap: 4px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
  padding: 12px;
  background: rgb(var(--la-card-tint-rgb) / 0.035);
}
.lead-metric > span {
  font-size: 11px;
  opacity: 0.6;
}
.lead-metric strong {
  font-size: 24px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.lead-metric small {
  font-size: 13px;
  opacity: 0.5;
  font-weight: 400;
}
.lead-entry-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  width: 100%;
  padding: 3px 0;
}
.lead-entry-name {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}
.lead-entry-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-top: 6px;
}
.checkpoint-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.checkpoint-card {
  padding: 10px 12px;
  border: 1px solid rgb(var(--la-card-border-rgb) / 0.1);
  border-radius: 6px;
}
.checkpoint-title {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
  font-weight: 500;
}
.checkpoint-value {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 2px 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.checkpoint-value > span {
  opacity: 0.6;
}
.checkpoint-value > strong {
  font-weight: 500;
}
.event-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 320px;
  overflow: auto;
}
.event-row {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.event-time {
  min-width: 38px;
  opacity: 0.6;
  font-variant-numeric: tabular-nums;
}
@media (max-width: 740px) {
  .lead-metrics {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .checkpoint-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 380px) {
  .lead-metrics {
    grid-template-columns: 1fr;
  }
  .control-field {
    width: 100%;
  }
}
</style>
