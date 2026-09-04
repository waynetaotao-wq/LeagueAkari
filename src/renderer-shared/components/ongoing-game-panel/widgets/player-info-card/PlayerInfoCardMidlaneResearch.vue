<template>
  <div v-if="visible" class="mb-1 flex w-full">
    <NPopover :keep-alive-on-hover="true" :delay="50" :disabled="!hasData">
      <template #trigger>
        <div
          class="flex w-full cursor-pointer items-center gap-2 rounded border border-fuchsia-500/60 bg-fuchsia-500/8 px-2 py-1 transition-[filter] hover:brightness-110 dark:border-fuchsia-300/56 dark:bg-fuchsia-300/8"
        >
          <div class="shrink-0">
            <GankMap
              v-if="hasData"
              :position-points="deep.minutePositions"
              :kill-points="deep.killPoints"
              :size="48"
              heatmap
              :heatmap-grid-size="7"
              :heatmap-cell-limit="14"
            />
            <div
              v-else
              class="flex size-12 shrink-0 items-center justify-center rounded bg-black/10 text-[10px] text-black/35 dark:bg-white/10 dark:text-white/35"
            >
              中
            </div>
          </div>

          <div class="flex min-w-0 flex-1 flex-col justify-center gap-1 text-[11px]">
            <template v-if="hasData">
              <div class="flex min-w-0 items-center gap-1.5 text-black/80 dark:text-white/80">
                <ChampionIcon
                  v-if="championId"
                  :champion-id="championId"
                  class="size-4 shrink-0 rounded-full"
                />
                <span class="shrink-0 font-semibold text-fuchsia-900/75 dark:text-fuchsia-100/80">
                  {{ deep.deepGames }} 场<template v-if="state.phase === 'deep'">↻</template>
                </span>
                <span class="shrink-0 text-black/35 dark:text-white/35">·</span>
                <span class="min-w-0 truncate whitespace-nowrap" :class="styleClass">{{
                  styleText
                }}</span>
              </div>
              <div class="flex min-w-0 text-black/75 dark:text-white/75">
                <span class="inline-flex min-w-0 gap-1.5 whitespace-nowrap">
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-red-600 dark:text-red-400">上</span>
                    <span>{{ percentage(zonePct.top) }}</span>
                  </span>
                  <span class="text-black/25 dark:text-white/25">|</span>
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-amber-600 dark:text-yellow-400">中</span>
                    <span>{{ percentage(zonePct.mid) }}</span>
                  </span>
                  <span class="text-black/25 dark:text-white/25">|</span>
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-blue-600 dark:text-blue-400">下</span>
                    <span>{{ percentage(zonePct.bot) }}</span>
                  </span>
                  <span class="text-black/25 dark:text-white/25">|</span>
                  <span>约 10 分钟经济 {{ signed(goldDiff10) }}</span>
                </span>
              </div>
            </template>
            <div v-else class="text-black/50 dark:text-white/50">{{ progressText }}</div>
            <NButton v-if="canRetry" size="tiny" quaternary @click.stop="run">重试中单研究</NButton>
          </div>
        </div>
      </template>

      <div v-if="hasData" class="flex max-w-140 flex-col gap-2">
        <div class="flex items-center gap-1.5 text-xs">
          <ChampionIcon v-if="championId" :champion-id="championId" class="size-4 rounded" />
          <span class="font-medium">中单研究</span>
          <span
            class="rounded bg-black/6 px-1 text-[10px] leading-4 text-black/55 dark:bg-white/8 dark:text-white/60"
          >
            {{ deep.deepGames }} 场有效详析 · 共 {{ totalGames }} 场{{ sliceText }}
          </span>
        </div>

        <!-- 地图偏好 -->
        <JunglePathingSection>
          <template #map>
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
          </template>
          <template #content>
            <div class="font-semibold">地图偏好</div>
            <div class="text-black/75 dark:text-white/75">
              {{ deep.deepGames }} 场 ·
              <span :class="styleClass">{{ styleText }}</span>
            </div>
            <div class="flex gap-3 text-black/75 dark:text-white/75">
              <span>分区权重</span>
              <span class="text-red-600 dark:text-red-400">上 {{ percentage(zonePct.top) }}</span>
              <span class="text-amber-600 dark:text-yellow-400"
                >中 {{ percentage(zonePct.mid) }}</span
              >
              <span class="text-blue-600 dark:text-blue-400">下 {{ percentage(zonePct.bot) }}</span>
            </div>

            <div class="mt-1 rounded border border-fuchsia-500/25 p-1.5">
              <div class="font-semibold">游走</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-black/75 dark:text-white/75">
                <span
                  >游走率 <b>{{ percentage(roam.ratePct) }}</b></span
                >
                <span
                  >场均 <b>{{ oneDecimal(roam.perGame) }}</b> 次</span
                >
                <span
                  >首次游走 <b>{{ roam.firstMedian }}</b></span
                >
                <span
                  >成功率 <b>{{ percentage(roam.successPct) }}</b></span
                >
                <span class="col-span-2">
                  去向
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
          </template>
        </JunglePathingSection>

        <div
          class="border-t border-black/5 pt-1.5 text-[10px] leading-relaxed text-black/35 dark:border-white/8 dark:text-white/35"
        >
          <div v-if="deep.timelineFailures">
            · {{ deep.attemptedGames }} 场已尝试，{{ deep.timelineFailures }}
            场时间线失败或不完整，已排除；失败样本可能影响代表性。
          </div>
          <div v-if="deep.deepGames < 10">· 有效样本少于 10 场，画像仅供参考。</div>
          <div v-if="state.result?.ladder.truncated">
            · 已达到战绩翻页上限，历史样本未全部扫描。
          </div>
          <div>
            · 只收该英雄本人中路、至少 5 分钟的完整
            5v5，排除重开/中止；版本范围为最近玩过的三个版本。
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
    </NPopover>
  </div>
</template>

<script lang="ts">
import type { MidDeepResult, MidLadderResult } from './midlane-research'

interface MidResult {
  ladder: MidLadderResult
  deep: MidDeepResult
}

/** 跨卡片实例缓存；按玩家、英雄和服务器隔离，失败结果不缓存。 */
const MIDLANE_CACHE_TTL = 30 * 60 * 1000
const midlaneCache = new Map<string, { at: number; result: MidResult }>()
</script>

<script setup lang="ts">
import GankMap from '@renderer-shared/components/jungle-pathing-analysis/GankMap.vue'
import JunglePathingSection from '@renderer-shared/components/jungle-pathing-analysis/JunglePathingSection.vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useInstance } from '@renderer-shared/shards'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { NButton, NPopover } from 'naive-ui'
import { computed, onBeforeUnmount, reactive, watch } from 'vue'

import { useOngoingGamePanel } from '../../context'
import {
  DEEP_GAMES,
  LEVEL_BUCKETS,
  TARGET_GAMES,
  analyzeDeep,
  collectVersionLadder,
  emptyDeepResult
} from './midlane-research'

const { puuid } = defineProps<{
  puuid: string
}>()

const { ongoingGame } = useOngoingGamePanel()
const sgp = useInstance(SgpRenderer)
const sgps = useSgpStore()

const position = computed(() => ongoingGame.value.positionAssignments?.[puuid]?.position)
const championId = computed(() => ongoingGame.value.championSelections?.[puuid] ?? null)
const sgpUsable = computed(() => sgps.availability.serversSupported.matchHistory)

const visible = computed(
  () => sgpUsable.value && position.value?.toUpperCase() === 'MIDDLE' && !!championId.value
)

const state = reactive<{
  phase: 'idle' | 'list' | 'deep' | 'done' | 'error'
  progressDone: number
  progressTotal: number
  result: MidResult | null
}>({ phase: 'idle', progressDone: 0, progressTotal: 0, result: null })

let seq = 0
/** 在途请求的中止器：依赖变化 / 卡片隐藏 / 卸载时取消旧一轮，避免 5 路并发在后台继续打 SGP */
let abort: AbortController | null = null

function cancelInFlight() {
  seq++
  if (abort) {
    abort.abort()
    abort = null
  }
}

async function run() {
  const myPuuid = puuid
  const myChampion = championId.value
  const myServerId = sgps.availability.sgpServerId
  if (!myPuuid || !myChampion) return
  const key = `${myPuuid}:${myChampion}:${myServerId}`
  const cached = midlaneCache.get(key)
  if (cached && Date.now() - cached.at < MIDLANE_CACHE_TTL) {
    cancelInFlight()
    state.result = cached.result
    state.phase = 'done'
    return
  }
  if (cached) midlaneCache.delete(key)
  cancelInFlight()
  const mySeq = seq
  abort = new AbortController()
  const signal = abort.signal
  state.phase = 'list'
  state.result = null
  state.progressDone = 0
  state.progressTotal = TARGET_GAMES
  try {
    const ladder = await collectVersionLadder(
      (startIndex, count) =>
        sgp.api.matchHistoryQuery
          .getMatchHistorySummaryByPlayerPuuid(myPuuid, {
            startIndex,
            count,
            __sgpServerId: myServerId
          })
          .then((r) => r.data),
      myPuuid,
      myChampion,
      undefined,
      (c, t) => {
        if (mySeq === seq) {
          state.progressDone = c
          state.progressTotal = t
        }
      },
      signal
    )
    if (mySeq !== seq || signal.aborted) return
    state.phase = 'deep'
    state.progressDone = 0
    state.progressTotal = Math.min(DEEP_GAMES, ladder.games.length)
    state.result = { ladder, deep: emptyDeepResult() }
    const deep = await analyzeDeep(
      ladder.games,
      (gameId) =>
        sgp.api.matchHistoryQuery
          .getGameDetailsByGameId(gameId, { __sgpServerId: myServerId })
          .then((r) => r.data),
      {
        onPartial: (partial) => {
          if (mySeq === seq) state.result = { ladder, deep: partial }
        }
      },
      (d, t) => {
        if (mySeq === seq) {
          state.progressDone = d
          state.progressTotal = t
        }
      },
      signal
    )
    if (mySeq !== seq || signal.aborted) return
    const result: MidResult = { ladder, deep }
    if (deep.deepGames > 0 && deep.timelineFailures === 0)
      midlaneCache.set(key, { at: Date.now(), result })
    state.result = result
    state.phase = 'done'
  } catch {
    if (mySeq === seq && !signal.aborted) state.phase = 'error'
  }
}

watch(
  () => [visible.value, puuid, championId.value, sgps.availability.sgpServerId] as const,
  ([v]) => {
    if (v) {
      void run()
    } else {
      // 不再可见（分路变化 / 英雄清空 / SGP 不可用）：中止在途请求，避免后台空转
      cancelInFlight()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  cancelInFlight()
})

const deep = computed<MidDeepResult>(() => state.result?.deep ?? emptyDeepResult())
const hasData = computed(() => !!state.result && deep.value.deepGames > 0)
const canRetry = computed(
  () => state.phase === 'error' || (state.phase === 'done' && deep.value.timelineFailures > 0)
)

const progressText = computed(() => {
  if (state.phase === 'list') return `拉取战绩 ${state.progressDone}/${state.progressTotal}…`
  if (state.phase === 'deep') return `分析时间线 ${state.progressDone}/${state.progressTotal}…`
  if (state.phase === 'error') return '中单研究获取失败'
  if (state.phase === 'done' && deep.value.timelineFailures > 0)
    return `时间线失败或不完整（${deep.value.timelineFailures} 场）`
  if (state.phase === 'done') return '没有符合条件的中路对局'
  return '中单研究准备中…'
})

const totalGames = computed(() => state.result?.ladder.games.length ?? 0)
const sliceText = computed(() => {
  const l = state.result?.ladder
  if (!l) return ''
  const s = l.slices.map((x) => `${x.version} ${x.games}`).join(' / ')
  return s ? `（${s}）` : ''
})

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
    const idx = max > 0 ? d.firstKillBuckets.indexOf(max) : -1
    const b = LEVEL_BUCKETS[idx]
    firstKillLevelText = `${b ? b.label : '等级缺失'}（${percentage(pct(d.firstKillGames, d.deepGames))} 有单杀）`
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

/** 一句话画像：游走型 / 对线型 / 均衡 */
const styleText = computed(() => {
  const r = roam.value
  const z = zonePct.value
  if (r.perGame === null || z.mid === null) return '位置样本不足'
  const roamy = r.perGame >= 1.2 || z.mid < 62
  const laney = r.perGame < 0.6 && z.mid >= 75
  const dir = (r.dirTopPct ?? 0) >= 60 ? '偏上' : (r.dirBotPct ?? 0) >= 60 ? '偏下' : ''
  if (roamy) return `游走型${dir ? ' · ' + dir : ''}`
  if (laney) return '对线型'
  return `均衡${dir ? ' · ' + dir : ''}`
})
const styleClass = computed(() =>
  styleText.value.startsWith('游走')
    ? 'text-red-600 dark:text-red-400'
    : styleText.value.startsWith('对线')
      ? 'text-emerald-700 dark:text-emerald-300'
      : 'text-black/70 dark:text-white/70'
)
</script>
