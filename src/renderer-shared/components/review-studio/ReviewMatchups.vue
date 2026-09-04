<template>
  <div class="matchups-view">
    <NEmpty v-if="!matches.length" description="选择英雄和位置，分析历史后建立你的对位档案" />
    <template v-else>
      <div class="section-heading">
        <div>
          <div class="section-title">对线表现档案</div>
          <div class="section-hint">
            {{ stats.games }} 场 · {{ stats.wins }} 胜 {{ stats.games - stats.wins }} 负 · 胜率
            {{ reviewPercent(stats.winRate) }} · 所有差值均相对同位置对手
          </div>
        </div>
        <NTag v-if="stats.games < 10" type="warning" size="small" :bordered="false">样本较少</NTag>
      </div>
      <div class="metric-grid">
        <ReviewMetricCard label="10 分钟平均经济差" :metric="stats.gold10" />
        <ReviewMetricCard label="15 分钟平均经济差" :metric="stats.gold15" />
        <ReviewMetricCard label="10 分钟平均补刀差" :metric="stats.cs10" :digits="1" />
        <ReviewMetricCard label="15 分钟平均补刀差" :metric="stats.cs15" :digits="1" />
      </div>
      <div class="section-hint">
        均值只使用该项有效快照，缺失数据不会记作
        0。可展开每个对位检查分布、阶段变化、原始对局和个人笔记。
      </div>
      <NCollapse accordion>
        <NCollapseItem v-for="group in groups" :key="groupKey(group)" :name="groupKey(group)">
          <template #header>
            <div class="matchup-header">
              <ChampionIcon
                v-if="group.opponentChampionId"
                :champion-id="group.opponentChampionId"
                class="size-7 shrink-0 rounded"
              />
              <div class="matchup-name">
                <span class="font-medium">{{
                  group.opponentChampionId
                    ? resources.champions.name(group.opponentChampionId)
                    : '对位未知'
                }}</span
                ><span class="section-hint"
                  >{{ group.games }} 场 · {{ reviewPercent(group.winRate) }} 胜率</span
                >
              </div>
              <div class="matchup-preview">
                <span>10 分钟 {{ reviewSigned(group.gold10.mean) }}</span
                ><span>15 分钟 {{ reviewSigned(group.gold15.mean) }}</span>
              </div>
              <NTag v-if="group.games < 10" type="warning" size="tiny" :bordered="false"
                >少量样本</NTag
              >
            </div>
          </template>
          <div class="matchup-body">
            <div class="metric-grid">
              <ReviewMetricCard label="10 分钟经济差" :metric="group.gold10" /><ReviewMetricCard
                label="15 分钟经济差"
                :metric="group.gold15"
              /><ReviewMetricCard
                label="10 分钟补刀差"
                :metric="group.cs10"
                :digits="1"
              /><ReviewMetricCard label="15 分钟补刀差" :metric="group.cs15" :digits="1" />
            </div>
            <ReviewTrend :matches="group.matches" @open="emit('open', $event)" />
            <ReviewNote
              :puuid="puuid"
              :sgp-server-id="sgpServerId"
              :champion-id="group.championId"
              :position="group.position"
              :opponent-champion-id="group.opponentChampionId"
            />
            <NCollapse
              ><NCollapseItem :title="`全部 ${group.games} 场 · 查看原始对局`" name="games"
                ><ReviewHistory
                  :matches="group.matches"
                  @open="emit('open', $event)" /></NCollapseItem
            ></NCollapse>
          </div>
        </NCollapseItem>
      </NCollapse>
      <NCollapse
        ><NCollapseItem title="当前筛选的整体阶段变化" name="overall"
          ><ReviewTrend :matches="matches" @open="emit('open', $event)" /></NCollapseItem
      ></NCollapse>
    </template>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { NCollapse, NCollapseItem, NEmpty, NTag } from 'naive-ui'
import { computed } from 'vue'

import ReviewHistory from './ReviewHistory.vue'
import ReviewMetricCard from './ReviewMetricCard.vue'
import ReviewNote from './ReviewNote.vue'
import ReviewTrend from './ReviewTrend.vue'
import { reviewPercent, reviewSigned } from './review-display'
import { groupReviewMatchups, summarizeReviewMatches } from './statistics'
import type { ReviewMatch, ReviewMatchupGroup } from './types'

const props = defineProps<{ matches: ReviewMatch[]; puuid: string; sgpServerId: string }>()
const emit = defineEmits<{ open: [gameId: number] }>()
const resources = useAkariResourceProvider()
const groups = computed(() => groupReviewMatchups(props.matches))
const stats = computed(() => summarizeReviewMatches(props.matches))
const groupKey = (group: ReviewMatchupGroup) =>
  `${group.championId}:${group.position}:${group.opponentChampionId ?? 'unknown'}`
</script>

<style scoped>
.matchups-view {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
}
.section-title {
  font-size: 15px;
  font-weight: 600;
  margin-bottom: 4px;
}
.section-hint {
  font-size: 11px;
  opacity: 0.6;
  line-height: 1.7;
}
.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.matchup-header {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 10px;
  flex-wrap: wrap;
  padding: 3px 0;
}
.matchup-name {
  display: flex;
  gap: 8px;
  flex: 1;
  align-items: baseline;
  min-width: 120px;
}
.matchup-preview {
  display: flex;
  gap: 18px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  opacity: 0.7;
}
.matchup-body {
  display: flex;
  flex-direction: column;
  gap: 18px;
  padding: 6px 0;
}
@media (max-width: 740px) {
  .metric-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .matchup-preview {
    flex-basis: 100%;
    padding-left: 38px;
  }
}
@media (max-width: 380px) {
  .metric-grid {
    grid-template-columns: 1fr;
  }
}
</style>
