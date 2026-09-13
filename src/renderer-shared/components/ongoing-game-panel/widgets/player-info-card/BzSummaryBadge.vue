<template>
  <NPopover
    v-if="bzRow"
    trigger="hover"
    placement="bottom"
    style="max-width: 320px"
    @update:show="refreshOnOpen"
  >
    <template #trigger>
      <div
        class="absolute top-1.5 right-8 z-10 flex h-4.5 cursor-default items-center rounded-full bg-[#8b2252]/90 px-1.5 text-[9px] font-bold text-white/95 select-none dark:bg-[#c2418f]/80"
      >
        Bz
      </div>
    </template>
    <div class="text-xs">
      <div v-if="bzRow.fetchedAt" class="mb-1 text-[10px] text-gray-500">
        {{ bzRow.stale ? '已核对记录' : '表格读取时间' }} ·
        <span v-if="bzRow.refreshing">自动同步中 · </span>
        {{ new Date(bzRow.fetchedAt).toLocaleString() }}
      </div>
      <div class="mb-1 font-bold">
        Bz 对线心得 · vs {{ bzRow.champion }}
        <span v-if="bzRow.difficulty" class="font-normal text-[#666666] dark:text-[#b2b2b2]">
          （难度 {{ bzRow.difficulty }}）
        </span>
      </div>
      <div class="leading-relaxed whitespace-pre-line">{{ displayText }}</div>
      <BzImageLoadout :row="bzRow" />
      <div
        v-if="!zhText && bzRow.summary"
        class="mt-1 text-[10px] text-[#666666] dark:text-[#b2b2b2]"
      >
        （当前内容暂未翻译，显示原文）
      </div>
    </div>
  </NPopover>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { CHAMPION_DATA_MAIN_NAMESPACE } from '@renderer-shared/shards/champion-data/context'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import type { BzGuideParams, BzGuideResult, BzMatchupRow } from '@shared/types/counter-intel'
import { NPopover } from 'naive-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import BzImageLoadout from '@renderer-shared/components/bz-guide/BzImageLoadout.vue'

import { useOngoingGamePanel } from '../../context'
import { getBzSummaryZh, isBzLaneOpponent, resolveBzSelfPuuid } from './bz-summary-zh'

const { puuid } = defineProps<{
  puuid: string
}>()

const { ongoingGame } = useOngoingGamePanel()
const ipc = useInstance(AkariIpcRenderer)

const myPuuid = computed(() =>
  resolveBzSelfPuuid(ongoingGame.value.draft?.puuid, ongoingGame.value.selfPuuid)
)
const myChampionId = computed(() =>
  myPuuid.value ? (ongoingGame.value.championSelections?.[myPuuid.value] ?? null) : null
)
const myPosition = computed(() =>
  myPuuid.value ? ongoingGame.value.positionAssignments?.[myPuuid.value]?.position : undefined
)
const targetPosition = computed(() => ongoingGame.value.positionAssignments?.[puuid]?.position)
const targetChampionId = computed(() => ongoingGame.value.championSelections?.[puuid] ?? null)

const BZ_RETRY_DELAYS_MS = [750, 2000] as const
const bzRow = ref<BzMatchupRow | null>(null)
const eligibleOpponentId = ref<number | null>(null)
let seq = 0
let retryTimer: ReturnType<typeof setTimeout> | null = null

function invalidateRequest() {
  seq++
  if (retryTimer !== null) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
}

function isUsableRow(
  response: BzGuideResult | null | undefined
): response is BzGuideResult & { found: true; row: BzMatchupRow } {
  return (
    response?.found === true &&
    typeof response.row?.champion === 'string' &&
    typeof response.row.summary === 'string' &&
    (response.row.summary.trim().length > 0 || !!response.row.imageReference)
  )
}

async function loadBzRow(requestSeq: number, opponentChampionId: number, attempt: number) {
  if (requestSeq !== seq) return

  let response: BzGuideResult | null = null
  try {
    response = await ipc.call<BzGuideResult>(CHAMPION_DATA_MAIN_NAMESPACE, 'counterIntel/bzGuide', {
      opponentChampionId,
      includeCoreItems: false
    } satisfies BzGuideParams)
  } catch {}

  if (requestSeq !== seq) return
  if (isUsableRow(response)) {
    bzRow.value = response.row
    return
  }

  bzRow.value = null
  const shouldRetry =
    response === null ||
    response.reason === undefined ||
    response.reason === 'slug-unavailable' ||
    response.reason === 'source-unavailable'
  if (!shouldRetry) return

  const retryDelay = BZ_RETRY_DELAYS_MS[attempt]
  if (retryDelay === undefined) return

  retryTimer = setTimeout(() => {
    retryTimer = null
    void loadBzRow(requestSeq, opponentChampionId, attempt + 1)
  }, retryDelay)
}

function refreshOnOpen(show: boolean) {
  if (!show || !targetChampionId.value || !bzRow.value?.fetchedAt) return
  const retrySoon =
    bzRow.value.stale ||
    !!bzRow.value.imageReference ||
    bzRow.value.imageLoadout?.status === 'unavailable'
  if (Date.now() - bzRow.value.fetchedAt < (retrySoon ? 60_000 : 10 * 60_000)) return
  invalidateRequest()
  void loadBzRow(seq, targetChampionId.value, 0)
}

watch(
  () =>
    [
      myPuuid.value,
      myChampionId.value,
      myPosition.value,
      targetPosition.value,
      targetChampionId.value,
      ongoingGame.value.teams
    ] as const,
  ([selfPuuid, selfChampionId, selfPosition, opponentPosition, opponentChampionId, teams]) => {
    invalidateRequest()
    bzRow.value = null
    eligibleOpponentId.value = null

    const eligible = isBzLaneOpponent({
      teams,
      selfPuuid,
      targetPuuid: puuid,
      selfChampionId,
      selfPosition,
      targetPosition: opponentPosition
    })
    if (!eligible || !opponentChampionId) return
    eligibleOpponentId.value = opponentChampionId

    void loadBzRow(seq, opponentChampionId, 0)
  },
  { immediate: true }
)

function refreshCurrentRecord() {
  if (document.visibilityState !== 'visible' || !eligibleOpponentId.value) return
  invalidateRequest()
  void loadBzRow(seq, eligibleOpponentId.value, 0)
}
ipc.onEventVue(CHAMPION_DATA_MAIN_NAMESPACE, 'bz-guide-updated', refreshCurrentRecord)
document.addEventListener('visibilitychange', refreshCurrentRecord)
const freshnessTimer = setInterval(refreshCurrentRecord, 60_000)

onBeforeUnmount(() => {
  clearInterval(freshnessTimer)
  document.removeEventListener('visibilitychange', refreshCurrentRecord)
  invalidateRequest()
  bzRow.value = null
})

const zhText = computed(() =>
  bzRow.value ? getBzSummaryZh(bzRow.value.champion, bzRow.value.summary) : null
)
const displayText = computed(() => zhText.value ?? bzRow.value?.summary ?? '')
</script>

<style scoped></style>
