<template>
  <slot />
</template>

<script lang="ts">
import type { MidResult } from './context'

const MIDLANE_CACHE_TTL = 30 * 60 * 1000
const midlaneCache = new Map<string, { at: number; result: MidResult }>()
</script>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { computed, onBeforeUnmount, reactive, watch } from 'vue'

import { useOngoingGamePanel } from '../../../context'
import {
  DEEP_GAMES,
  TARGET_GAMES,
  analyzeDeep,
  collectVersionLadder,
  emptyDeepResult
} from './analysis'
import { type MidResearchState, provideMidlaneResearch } from './context'

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
  () =>
    ongoingGame.value.isConnected &&
    sgpUsable.value &&
    position.value?.toUpperCase() === 'MIDDLE' &&
    !!championId.value
)

const state = reactive<MidResearchState>({
  phase: 'idle',
  progressDone: 0,
  progressTotal: 0,
  result: null
})

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
  if (!visible.value || !myPuuid || !myChampion) return
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
      state.result = null
      state.phase = 'idle'
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  cancelInFlight()
})

provideMidlaneResearch({
  visible,
  championId,
  isOpponent: computed(() => {
    const selfPuuid = ongoingGame.value.selfPuuid
    if (!selfPuuid) return false
    const teams = Object.values(ongoingGame.value.teams)
    const own = teams.filter((members) => members.includes(selfPuuid))
    const target = teams.filter((members) => members.includes(puuid))
    return own.length === 1 && target.length === 1 && own[0] !== target[0]
  }),
  identity: computed(() => {
    const stage = ongoingGame.value.queryStage
    const gameId =
      stage.gameInfo && 'gameId' in stage.gameInfo ? stage.gameInfo.gameId : stage.phase
    return `${puuid}:${championId.value}:${sgps.availability.sgpServerId}:${gameId}`
  }),
  state,
  retry: run
})
</script>
