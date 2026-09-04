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
                <span class="min-w-0 truncate whitespace-nowrap" :class="styleClass">{{ styleText }}</span>
              </div>
              <div class="flex min-w-0 text-black/75 dark:text-white/75">
                <span class="inline-flex min-w-0 gap-1.5 whitespace-nowrap">
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-red-600 dark:text-red-400">上</span>
                    <span>{{ zonePct.top }}%</span>
                  </span>
                  <span class="text-black/25 dark:text-white/25">|</span>
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-amber-600 dark:text-yellow-400">中</span>
                    <span>{{ zonePct.mid }}%</span>
                  </span>
                  <span class="text-black/25 dark:text-white/25">|</span>
                  <span class="inline-flex items-baseline gap-1">
                    <span class="text-blue-600 dark:text-blue-400">下</span>
                    <span>{{ zonePct.bot }}%</span>
                  </span>
                  <span class="text-black/25 dark:text-white/25">|</span>
                  <span>10 分钟经济 {{ signed(goldDiff10) }}</span>
                </span>
              </div>
            </template>
            <div v-else class="text-black/50 dark:text-white/50">{{ progressText }}</div>
          </div>
        </div>
      </template>

      <div v-if="hasData" class="flex max-w-140 flex-col gap-2">
        <div class="flex items-center gap-1.5 text-xs">
          <ChampionIcon v-if="championId" :champion-id="championId" class="size-4 rounded" />
          <span class="font-medium">中单研究</span>
          <span class="rounded bg-black/6 px-1 text-[10px] leading-4 text-black/55 dark:bg-white/8 dark:text-white/60">
            {{ deep.deepGames }} 场详析 · 共 {{ totalGames }} 场{{ sliceText }}
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
              <span>✕ 击杀参与点</span>
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
              <span class="text-red-600 dark:text-red-400">上 {{ zonePct.top }}%</span>
              <span class="text-amber-600 dark:text-yellow-400">中 {{ zonePct.mid }}%</span>
              <span class="text-blue-600 dark:text-blue-400">下 {{ zonePct.bot }}%</span>
            </div>

            <div class="mt-1 rounded border border-fuchsia-500/25 p-1.5">
              <div class="font-semibold">游走</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-black/75 dark:text-white/75">
                <span>游走率 <b>{{ roam.ratePct }}%</b></span>
                <span>场均 <b>{{ roam.perGame }}</b> 次</span>
                <span>首次游走 <b>{{ roam.firstMedian }}</b></span>
                <span>成功率 <b>{{ roam.successPct }}%</b></span>
                <span class="col-span-2">
                  去向
                  <span class="text-red-600 dark:text-red-400">上 {{ roam.dirTopPct }}%</span>
                  ·
                  <span class="text-blue-600 dark:text-blue-400">下 {{ roam.dirBotPct }}%</span>
                </span>
              </div>
            </div>

            <div class="rounded border border-fuchsia-500/25 p-1.5">
              <div class="font-semibold">对线（10 分钟）</div>
              <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-black/75 dark:text-white/75">
                <span>补刀差 <b>{{ signed(csDiff10) }}</b></span>
                <span>经济差 <b>{{ signed(goldDiff10) }}</b></span>
                <span>经济领先率 <b>{{ lane.leadPct }}%</b></span>
                <span>首杀等级 <b>{{ lane.firstKillLevelText }}</b></span>
                <span>单杀 <b>{{ lane.soloKillsPerGame }}</b> /局</span>
                <span>被单杀 <b>{{ lane.soloDeathsPerGame }}</b> /局</span>
              </div>
            </div>

            <div class="rounded border border-fuchsia-500/25 p-1.5">
              <div class="font-semibold">前期参团（14 分钟前）</div>
              <div class="text-black/75 dark:text-white/75">
                参团率 <b>{{ kp.pct }}%</b> · 场均参与 <b>{{ kp.perGame }}</b> 次击杀
              </div>
            </div>
          </template>
        </JunglePathingSection>

        <div class="border-t border-black/5 pt-1.5 text-[10px] leading-relaxed text-black/35 dark:border-white/8 dark:text-white/35">
          <div>· 位置点来自时间线每分钟坐标快照；游走 = 进入上/下路走廊或在走廊参与击杀（河道/野区插眼、帮野、打龙不计）；成功 = 段内 90 秒有本人参与的击杀。</div>
          <div>· 坐标快照为分钟级：一分钟内往返的短游走可能漏计，首次游走时间精度 ±1 分钟。</div>
          <div>· 对线差取 10:00 帧相对敌方中单；被单杀只计中路带内。</div>
        </div>
      </div>
    </NPopover>
  </div>
</template>

<script setup lang="ts">
import GankMap from '@renderer-shared/components/jungle-pathing-analysis/GankMap.vue'
import JunglePathingSection from '@renderer-shared/components/jungle-pathing-analysis/JunglePathingSection.vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useInstance } from '@renderer-shared/shards'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { NPopover } from 'naive-ui'
import { computed, onBeforeUnmount, reactive, watch } from 'vue'

import { useOngoingGamePanel } from '../../context'
import {
  DEEP_GAMES,
  LEVEL_BUCKETS,
  TARGET_GAMES,
  type MidDeepResult,
  type MidLadderResult,
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

interface MidResult {
  ladder: MidLadderResult
  deep: MidDeepResult
}

/** 模块级缓存：同一对局界面反复渲染 / 重进不重拉；30 分钟过期，整天不关客户端也不会跨版本沿用旧结论 */
const MIDLANE_CACHE_TTL = 30 * 60 * 1000
const midlaneCache = new Map<string, { at: number; result: MidResult }>()

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
  if (!myPuuid || !myChampion) return
  const key = `${myPuuid}:${myChampion}:${sgps.availability.sgpServerId}`
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
            __sgpServerId: sgps.availability.sgpServerId
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
          .getGameDetailsByGameId(gameId, { __sgpServerId: sgps.availability.sgpServerId })
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
    midlaneCache.set(key, { at: Date.now(), result })
    state.result = result
    state.phase = 'done'
  } catch {
    if (mySeq === seq) state.phase = 'error'
  }
}

watch(
  () => [visible.value, puuid, championId.value] as const,
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

const progressText = computed(() => {
  if (state.phase === 'list') return `拉取战绩 ${state.progressDone}/${state.progressTotal}…`
  if (state.phase === 'deep') return `分析时间线 ${state.progressDone}/${state.progressTotal}…`
  if (state.phase === 'error') return '中单研究失败（稍后重试）'
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
  return d > 0 ? Math.round((n / d) * 100) : 0
}
function signed(n: number) {
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
  const median = times.length ? times[Math.floor(times.length / 2)] : null
  const dirTotal = d.roamEpisodeDirs.top + d.roamEpisodeDirs.bot
  return {
    ratePct: pct(d.roamFirstTimesMs.length, d.deepGames),
    perGame: d.deepGames ? (d.roamEpisodes / d.deepGames).toFixed(1) : '0',
    firstMedian: median !== null ? mmss(median) : '—',
    successPct: pct(d.roamSuccess, d.roamEpisodes),
    dirTopPct: pct(d.roamEpisodeDirs.top, dirTotal),
    dirBotPct: pct(d.roamEpisodeDirs.bot, dirTotal)
  }
})

const csDiff10 = computed(() => (deep.value.laneDiffGames ? deep.value.csDiff10Sum / deep.value.laneDiffGames : 0))
const goldDiff10 = computed(() => (deep.value.laneDiffGames ? deep.value.goldDiff10Sum / deep.value.laneDiffGames : 0))

const lane = computed(() => {
  const d = deep.value
  let firstKillLevelText = '—'
  if (d.firstKillGames > 0) {
    const idx = d.firstKillBuckets.indexOf(Math.max(...d.firstKillBuckets))
    const b = LEVEL_BUCKETS[idx]
    firstKillLevelText = b ? `${b.label}（${pct(d.firstKillGames, d.deepGames)}% 有单杀）` : '—'
  }
  return {
    leadPct: pct(d.goldLead10Games, d.laneDiffGames),
    firstKillLevelText,
    soloKillsPerGame: d.deepGames ? (d.soloKills / d.deepGames).toFixed(1) : '0',
    soloDeathsPerGame: d.deepGames ? (d.soloDeaths / d.deepGames).toFixed(1) : '0'
  }
})

const kp = computed(() => {
  const d = deep.value
  return {
    pct: pct(d.earlyTakedowns, d.earlyTeamKills),
    perGame: d.deepGames ? (d.earlyTakedowns / d.deepGames).toFixed(1) : '0'
  }
})

/** 一句话画像：游走型 / 对线型 / 均衡 */
const styleText = computed(() => {
  const r = roam.value
  const z = zonePct.value
  const roamy = Number(r.perGame) >= 1.2 || z.mid < 62
  const laney = Number(r.perGame) < 0.6 && z.mid >= 75
  const dir =
    r.dirTopPct >= 60 ? '偏上' : r.dirBotPct >= 60 ? '偏下' : ''
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
