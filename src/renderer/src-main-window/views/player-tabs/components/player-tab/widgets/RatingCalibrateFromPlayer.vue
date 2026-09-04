<template>
  <div
    v-if="sgpUsable"
    class="rounded-md border border-black/10 bg-white/60 px-3 py-2 text-xs dark:border-white/10 dark:bg-white/5"
  >
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="font-bold">评分权重校准</div>
        <div class="truncate text-[11px] text-black/60 dark:text-white/60">
          {{ statusText }}
        </div>
      </div>
      <NButton
        size="tiny"
        secondary
        :type="isSelfTab ? 'default' : 'primary'"
        :loading="calibrating"
        :disabled="calibrating"
        @click="start"
      >
        {{ calibrating ? progressText : isSelfTab ? '用我的战绩校准' : '用他的战绩校准' }}
      </NButton>
    </div>
    <div class="mt-1 text-[10px] leading-4 text-black/45 dark:text-white/40">
      用这位玩家最近 400 场峡谷对局调整分路权重；达到 60 场后留出部分对局验证。
      校准学习的是数据与胜负的相关性，不等同于个人贡献或“高手标准”；结果全局生效。
    </div>
  </div>
</template>

<script setup lang="ts">
import { parseStoredCalibration } from '@renderer-shared/components/match-card/utils/akari-score-calibration'
import { useRatingCalibration } from '@renderer-shared/components/match-card/utils/use-rating-calibration'
import { useMatchRatingStore } from '@renderer-shared/shards/match-rating/store'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { NButton } from 'naive-ui'
import { computed } from 'vue'

import { usePlayerTab } from '../context'
import { useSummoner } from '../data/summoner'

const { puuid, sgpServerId, isSelfTab } = usePlayerTab()
const { summoner } = useSummoner()
const sgps = useSgpStore()
const mrs = useMatchRatingStore()
const { calibrating, progressText, calibrate } = useRatingCalibration()

const sgpUsable = computed(() => sgps.availability.serversSupported.matchHistory)

const statusText = computed(() => {
  const c = parseStoredCalibration(mrs.settings.calibration)
  if (!c) return mrs.settings.calibration ? '校准记录需更新，暂用内置权重' : '当前使用内置权重'
  const who = c.sourceName ? `基于 ${c.sourceName}` : '已校准'
  const same = c.sourcePuuid === puuid.value ? '（就是此玩家）' : ''
  const validation = c.validation ? ` · 留出 ${c.validation.games} 场验证` : ' · 尚未独立验证'
  return `${who} ${c.trainingGames} 场拟合${same}${validation}`
})

function start() {
  if (!puuid.value) return
  void calibrate({
    puuid: puuid.value,
    sgpServerId: sgpServerId.value,
    name: summoner.value?.gameName || undefined
  })
}
</script>
