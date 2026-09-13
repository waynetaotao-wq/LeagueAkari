<template>
  <div class="flex flex-col gap-3 text-xs">
    <div class="text-[11px] text-black/55 dark:text-white/55">
      共收集 {{ result.ladder.games.length }} 场；版本
      {{ result.ladder.slices.map((s) => `${s.version}（${s.games} 场）`).join(' / ') || '未知' }}。
    </div>
    <!-- 地图偏好 -->
    <div class="flex flex-col gap-3">
      <div class="flex items-center gap-3">
        <GankMap
          :position-points="deep.minutePositions"
          :kill-points="deep.killPoints"
          :size="140"
          :position-limit="54"
          :kill-limit="100"
          balance-by-lane
          show-side-fill
          position-dot-size-class="h-1 w-1"
          kill-marker-size-class="h-3 w-3"
        />
        <div class="flex flex-col gap-0.5 pl-0.5 text-[10px] text-black/55 dark:text-white/55">
          <span>● 位置点（2–14 分钟）</span>
          <span>✕ 击杀发生地（含远程参与）</span>
        </div>
      </div>
      <div class="flex flex-col gap-2">
        <div class="font-semibold">地图偏好</div>
        <div class="flex gap-3 text-black/75 dark:text-white/75">
          <span>分区权重</span>
          <span class="text-red-600 dark:text-red-400">上 {{ percentage(zonePct.top) }}</span>
          <span class="text-amber-600 dark:text-yellow-400">中 {{ percentage(zonePct.mid) }}</span>
          <span class="text-blue-600 dark:text-blue-400">下 {{ percentage(zonePct.bot) }}</span>
        </div>

        <div class="mt-1 rounded border border-fuchsia-500/25 p-1.5">
          <div class="font-semibold">游走</div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-black/75 dark:text-white/75">
            <span
              >有游走的对局 <b>{{ percentage(roam.ratePct) }}</b></span
            >
            <span
              >场均 <b>{{ oneDecimal(roam.perGame) }}</b> 次</span
            >
            <span
              >首次游走中位 <b>{{ roam.firstMedian }}</b></span
            >
            <span
              >参与击杀占比 <b>{{ percentage(roam.successPct) }}</b></span
            >
            <span class="col-span-2">
              全部游走片段去向
              <span class="text-red-600 dark:text-red-400"
                >上 {{ percentage(roam.dirTopPct) }}</span
              >
              ·
              <span class="text-blue-600 dark:text-blue-400"
                >下 {{ percentage(roam.dirBotPct) }}</span
              >
            </span>
          </div>
        </div>

        <div class="rounded border border-fuchsia-500/25 p-1.5">
          <div class="font-semibold">对线（约 10 分钟，{{ deep.laneDiffGames }} 场有效）</div>
          <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-black/75 dark:text-white/75">
            <span
              >补刀差 <b>{{ signed(csDiff10) }}</b></span
            >
            <span
              >经济差 <b>{{ signed(goldDiff10) }}</b></span
            >
            <span
              >经济领先率 <b>{{ percentage(lane.leadPct) }}</b></span
            >
            <span
              >前期首次单杀 <b>{{ lane.firstKillLevelText }}</b></span
            >
            <span
              >前期单杀 <b>{{ oneDecimal(lane.soloKillsPerGame) }}</b> /局</span
            >
            <span
              >前期被单杀 <b>{{ oneDecimal(lane.soloDeathsPerGame) }}</b> /局</span
            >
          </div>
        </div>

        <div class="rounded border border-fuchsia-500/25 p-1.5">
          <div class="font-semibold">前期参团（14 分钟前）</div>
          <div class="text-black/75 dark:text-white/75">
            参团率 <b>{{ percentage(kp.pct) }}</b> · 场均参与
            <b>{{ oneDecimal(kp.perGame) }}</b> 次击杀
          </div>
        </div>
      </div>
    </div>

    <div
      class="border-t border-black/8 pt-2 text-[11px] leading-relaxed text-black/55 dark:border-white/10 dark:text-white/55"
    >
      <div v-if="deep.timelineFailures">
        · {{ deep.attemptedGames }} 场已尝试，{{ deep.timelineFailures }}
        场时间线失败或不完整，已排除；失败样本可能影响代表性。
      </div>
      <div v-if="deep.deepGames < 10">· 有效样本少于 10 场，画像仅供参考。</div>
      <div v-if="result.ladder.truncated">· 已达到战绩翻页上限，历史样本未全部扫描。</div>
      <div>
        · 只收该英雄本人中路、至少 5 分钟的完整 5v5，排除重开/中止；版本范围为最近玩过的三个版本。
      </div>
      <div>
        · 游走以本人上/下路走廊快照为证；击杀须有最近 60 秒内同走廊、相距 3000
        地图单位内的本人快照佐证，成功按片段前后 90 秒内的上述参与计。击杀发生地不等于本人位置。
      </div>
      <div>· 坐标快照为分钟级：一分钟内往返的短游走可能漏计，首次游走时间精度 ±1 分钟。</div>
      <div>
        · 对线差取 10:00 前后 5 秒内最近快照，相对敌方中单；缺失显示
        —。单杀、首次单杀等级与参团均统计前 14 分钟，被单杀只计中路带内。
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import GankMap from '@renderer-shared/components/jungle-pathing-analysis/GankMap.vue'
import { computed } from 'vue'

import { LEVEL_BUCKETS } from './analysis'
import type { MidResult } from './context'

const { result } = defineProps<{ result: MidResult }>()
const deep = computed(() => result.deep)

function pct(n: number, d: number) {
  return d > 0 ? Math.round((n / d) * 100) : null
}
function percentage(n: number | null) {
  return n === null ? '—' : `${n}%`
}
function oneDecimal(n: number | null) {
  return n === null ? '—' : n.toFixed(1)
}
function signed(n: number | null) {
  if (n === null) return '—'
  const r = Math.round(n)
  return r > 0 ? `+${r}` : `${r}`
}
function mmss(ms: number) {
  const s = Math.round(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const zonePct = computed(() => {
  const z = deep.value.zoneFrames
  const total = z.top + z.mid + z.bot
  return { top: pct(z.top, total), mid: pct(z.mid, total), bot: pct(z.bot, total) }
})

const roam = computed(() => {
  const d = deep.value
  const times = [...d.roamFirstTimesMs].sort((a, b) => a - b)
  const median = times.length
    ? (times[Math.floor((times.length - 1) / 2)] + times[Math.floor(times.length / 2)]) / 2
    : null
  const dirTotal = d.roamEpisodeDirs.top + d.roamEpisodeDirs.bot
  return {
    ratePct: pct(d.roamFirstTimesMs.length, d.deepGames),
    perGame: d.deepGames ? d.roamEpisodes / d.deepGames : null,
    firstMedian: median !== null ? mmss(median) : '—',
    successPct: pct(d.roamSuccess, d.roamEpisodes),
    dirTopPct: pct(d.roamEpisodeDirs.top, dirTotal),
    dirBotPct: pct(d.roamEpisodeDirs.bot, dirTotal)
  }
})

const csDiff10 = computed(() =>
  deep.value.laneDiffGames ? deep.value.csDiff10Sum / deep.value.laneDiffGames : null
)
const goldDiff10 = computed(() =>
  deep.value.laneDiffGames ? deep.value.goldDiff10Sum / deep.value.laneDiffGames : null
)

const lane = computed(() => {
  const d = deep.value
  let firstKillLevelText = '—'
  if (d.firstKillGames > 0) {
    const max = Math.max(...d.firstKillBuckets)
    const levels = LEVEL_BUCKETS.filter((_, i) => max > 0 && d.firstKillBuckets[i] === max)
    firstKillLevelText = `${levels.map((b) => b.label).join(' / ') || '等级缺失'}（${percentage(pct(d.firstKillGames, d.deepGames))} 有单杀）`
  }
  return {
    leadPct: pct(d.goldLead10Games, d.laneDiffGames),
    firstKillLevelText,
    soloKillsPerGame: d.deepGames ? d.soloKills / d.deepGames : null,
    soloDeathsPerGame: d.deepGames ? d.soloDeaths / d.deepGames : null
  }
})

const kp = computed(() => {
  const d = deep.value
  return {
    pct: pct(d.earlyTakedowns, d.earlyTeamKills),
    perGame: d.deepGames ? d.earlyTakedowns / d.deepGames : null
  }
})
</script>
