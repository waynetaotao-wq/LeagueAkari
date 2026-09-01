<template>
  <div v-if="visible" class="mb-1 flex w-full">
    <NPopover :keep-alive-on-hover="true" :delay="50" :disabled="!hasData">
      <template #trigger>
        <div
          class="flex w-full cursor-default items-center gap-2 rounded border border-fuchsia-500/60 bg-fuchsia-500/8 px-2 py-1 transition-[filter] hover:brightness-110 dark:border-fuchsia-300/56 dark:bg-fuchsia-300/8"
        >

          <div class="flex min-w-0 flex-1 flex-col justify-center gap-1 text-[11px]">
            <template v-if="hasData">
              <div class="flex min-w-0 items-center gap-1.5 text-black/80 dark:text-white/80">
                <ChampionIcon
                  v-if="championId"
                  :champion-id="championId"
                  class="size-4 shrink-0 rounded-full"
                />
                <span class="shrink-0 font-semibold text-fuchsia-900/75 dark:text-fuchsia-100/80">
                  {{ state.result!.deep.deepGames }}场深析<template v-if="state.phase === 'deep'">↻</template>
                </span>
                <span class="shrink-0 text-black/35 dark:text-white/35">·</span>
                <span class="min-w-0 truncate whitespace-nowrap">
                  <template v-if="topKillBucket">首杀 {{ topKillBucket.text }}</template>
                  <template v-else>深析样本中无单杀</template>
                </span>
              </div>
              <div class="flex min-w-0 text-black/75 dark:text-white/75">
                <span class="inline-flex min-w-0 gap-1.5 whitespace-nowrap">
                  <template v-if="topRoamBucket">
                    <span>首游 {{ topRoamBucket.text }}</span>
                    <span class="text-black/25 dark:text-white/25">|</span>
                    <span class="text-red-600 dark:text-red-400">上 {{ dirPct.top }}%</span>
                    <span class="text-amber-600 dark:text-yellow-400">侵 {{ dirPct.invade }}%</span>
                    <span class="text-blue-600 dark:text-blue-400">下 {{ dirPct.bot }}%</span>
                  </template>
                  <template v-else>深析样本中未捕捉到游走</template>
                </span>
              </div>
            </template>
            <template v-else-if="state.phase === 'error'">
              <div class="text-black/50 dark:text-white/50">中单研究：数据拉取失败</div>
            </template>
            <template v-else>
              <div class="text-black/50 dark:text-white/50">中单研究 · {{ progressText }}</div>
            </template>
          </div>
        </div>
      </template>

      <div v-if="state.result" class="flex max-w-120 flex-col gap-2 text-xs">
        <div class="flex items-center gap-1.5 text-[13px] font-bold">
          <ChampionIcon v-if="championId" :champion-id="championId" class="size-4.5 rounded" />
          中单研究
          <span class="font-normal text-black/45 dark:text-white/45">
            共 {{ totalGames }} 场 · 胜率 {{ totalWinRate }}%
          </span>
        </div>

        <div>
          <div class="mb-0.5 font-bold text-black/60 dark:text-white/55">
            首次单杀等级（{{ state.result.deep.firstKillGames }}/{{ state.result.deep.deepGames }} 局发生）
          </div>
          <div class="flex flex-wrap gap-x-2 gap-y-0.5">
            <span
              v-for="(b, i) of killBucketRows"
              :key="i"
              :class="i === 0 ? 'font-bold text-emerald-600 dark:text-emerald-400' : ''"
            >
              {{ b }}
            </span>
            <span v-if="!killBucketRows.length" class="text-black/40 dark:text-white/40">
              深析样本中从未单杀
            </span>
          </div>
        </div>

        <div>
          <div class="mb-0.5 font-bold text-black/60 dark:text-white/55">
            首次游走时间（{{ state.result.deep.roamGames }}/{{ state.result.deep.deepGames }} 局捕捉）
          </div>
          <div class="flex flex-wrap gap-x-2 gap-y-0.5">
            <span
              v-for="(b, i) of roamBucketRows"
              :key="i"
              :class="i === 0 ? 'font-bold text-emerald-600 dark:text-emerald-400' : ''"
            >
              {{ b }}
            </span>
            <span v-if="!roamBucketRows.length" class="text-black/40 dark:text-white/40">
              深析样本中未捕捉到游走
            </span>
          </div>
          <div v-if="state.result.deep.roamGames > 0" class="mt-0.5 text-black/70 dark:text-white/70">
            去向：
            <span class="text-red-600 dark:text-red-400">偏上 {{ dirPct.top }}%</span> ·
            <span class="text-amber-600 dark:text-yellow-400">入侵野区 {{ dirPct.invade }}%</span> ·
            <span class="text-blue-600 dark:text-blue-400">偏下 {{ dirPct.bot }}%</span>
          </div>
        </div>

        <div class="border-t border-black/5 pt-1.5 text-[11px] leading-relaxed text-black/35 dark:border-white/8 dark:text-white/35">
          <div>样本：{{ sliceText }}<template v-if="state.result.ladder.truncated">（已达翻页上限，样本可能不完整）</template></div>
          <div>
            深度分析取其中最近 {{ state.result.deep.deepGames
            }}<template v-if="state.phase === 'deep'">/{{ state.progressTotal }}（分析中，数字会继续收敛）</template>
            场时间线；首次游走 = 分钟级坐标帧 + 击杀/助攻事件坐标双信号取更早者，快去快回且无战果的游走可能漏检。
          </div>
        </div>
      </div>
    </NPopover>
  </div>
</template>

<script setup lang="ts">
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
  ROAM_TIME_BUCKETS,
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

const hasData = computed(() => !!state.result && state.result.deep.deepGames > 0)

const progressText = computed(() => {
  if (state.phase === 'list') return `拉取战绩 ${state.progressDone}/${state.progressTotal}`
  if (state.phase === 'deep') return `深度分析 ${state.progressDone}/${state.progressTotal}`
  return '待命'
})

const totalGames = computed(() => state.result?.ladder.games.length ?? 0)
const totalWinRate = computed(() => {
  const g = state.result?.ladder.games ?? []
  if (!g.length) return '0.0'
  return ((g.filter((x) => x.win).length / g.length) * 100).toFixed(1)
})

function rankRows(
  buckets: number[],
  total: number,
  labels: readonly { label: string }[]
): { text: string; short: string }[] {
  if (!total) return []
  return buckets
    .map((n, i) => ({ n, i }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => ({
      text: `${labels[x.i].label} ${Math.round((x.n / total) * 100)}%`,
      short: labels[x.i].label.replace('级', '').replace('当级', '级')
    }))
}

const killRanked = computed(() =>
  state.result
    ? rankRows(state.result.deep.firstKillBuckets, state.result.deep.firstKillGames, LEVEL_BUCKETS)
    : []
)
const roamRanked = computed(() =>
  state.result
    ? rankRows(state.result.deep.roamTimeBuckets, state.result.deep.roamGames, ROAM_TIME_BUCKETS)
    : []
)
const topKillBucket = computed(() => killRanked.value[0] ?? null)
const topRoamBucket = computed(() => roamRanked.value[0] ?? null)
const killBucketRows = computed(() => killRanked.value.map((x) => x.text))
const roamBucketRows = computed(() => roamRanked.value.map((x) => x.text))

const dirPct = computed(() => {
  const d = state.result?.deep
  const total = d?.roamGames ?? 0
  const p = (n: number) => (total ? Math.round((n / total) * 100) : 0)
  return {
    top: p(d?.roamDirs.top ?? 0),
    bot: p(d?.roamDirs.bot ?? 0),
    invade: p(d?.roamDirs.invade ?? 0)
  }
})

const sliceText = computed(() => {
  const s = state.result?.ladder.slices ?? []
  if (!s.length) return '无'
  return s.map((x) => `${x.version} ${x.games}场`).join(' + ') + ` = ${totalGames.value}场`
})
</script>

<style scoped></style>
