<template>
  <NPopover v-if="bzRow" trigger="hover" placement="bottom" style="max-width: 320px">
    <template #trigger>
      <div
        class="absolute top-1.5 right-8 z-10 flex h-4.5 cursor-default items-center rounded-full bg-[#8b2252]/90 px-1.5 text-[9px] font-bold text-white/95 select-none dark:bg-[#c2418f]/80"
      >
        Bz
      </div>
    </template>
    <div class="text-xs">
      <div class="mb-1 font-bold">
        Bz 对线心得 · vs {{ bzRow.champion }}
        <span v-if="bzRow.difficulty" class="font-normal text-[#666666] dark:text-[#b2b2b2]">
          （难度 {{ bzRow.difficulty }}）
        </span>
      </div>
      <div class="leading-relaxed whitespace-pre-line">{{ displayText }}</div>
      <div
        v-if="extras"
        class="mt-1.5 flex items-center gap-2 border-t border-black/5 pt-1.5 dark:border-white/8"
      >
        <span class="text-[10px] text-[#666666] dark:text-[#b2b2b2]">召唤师</span>
        <SummonerSpellDisplay
          v-for="(sid, i) of extras.spellIds"
          :key="i"
          :spell-id="sid"
          :size="18"
        />
        <span class="ml-1 text-[10px] text-[#666666] dark:text-[#b2b2b2]">出门</span>
        <ItemDisplay :item-id="extras.starterItemId" :size="18" />
      </div>
      <div v-if="!zhText" class="mt-1 text-[10px] text-[#666666] dark:text-[#b2b2b2]">
        （表内新条目，暂未翻译，显示原文）
      </div>
    </div>
  </NPopover>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { CHAMPION_DATA_MAIN_NAMESPACE } from '@renderer-shared/shards/champion-data/context'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { NPopover } from 'naive-ui'
import { computed, ref, watch } from 'vue'

import ItemDisplay from '@renderer-shared/components/widgets/ItemDisplay.vue'
import SummonerSpellDisplay from '@renderer-shared/components/widgets/SummonerSpellDisplay.vue'

import { useOngoingGamePanel } from '../../context'
import { getBzExtras, getBzSummaryZh } from './bz-summary-zh'

const { puuid } = defineProps<{
  puuid: string
}>()

const ZED_ID = 238

const { ongoingGame } = useOngoingGamePanel()
const lcs = useLeagueClientStore()
const ipc = useInstance(AkariIpcRenderer)

const myPuuid = computed(() => lcs.summoner.me?.puuid ?? null)
const myChampionId = computed(() =>
  myPuuid.value ? (ongoingGame.value.championSelections?.[myPuuid.value] ?? null) : null
)
const myPosition = computed(() =>
  myPuuid.value ? ongoingGame.value.positionAssignments?.[myPuuid.value]?.position : undefined
)
const targetPosition = computed(() => ongoingGame.value.positionAssignments?.[puuid]?.position)
const targetChampionId = computed(() => ongoingGame.value.championSelections?.[puuid] ?? null)

/** 该玩家是否为"我的对位对手"：非我本人、与我同位置、我方英雄为劫 */
const isMyLaneOpponent = computed(
  () =>
    myChampionId.value === ZED_ID &&
    !!myPuuid.value &&
    puuid !== myPuuid.value &&
    !!myPosition.value &&
    !!targetPosition.value &&
    targetPosition.value === myPosition.value
)

const bzRow = ref<{ champion: string; difficulty: string; summary: string } | null>(null)
let seq = 0

watch(
  [isMyLaneOpponent, targetChampionId],
  async ([ok, champId]) => {
    const mySeq = ++seq
    if (!ok || !champId) {
      bzRow.value = null
      return
    }
    try {
      const res = await ipc.call<{ found: boolean; row: any }>(
        CHAMPION_DATA_MAIN_NAMESPACE,
        'counterIntel/bzGuide',
        { opponentChampionId: champId }
      )
      if (mySeq !== seq) return
      bzRow.value = res?.found && res.row?.summary ? res.row : null
    } catch {
      if (mySeq === seq) bzRow.value = null
    }
  },
  { immediate: true }
)

const zhText = computed(() => (bzRow.value ? getBzSummaryZh(bzRow.value.champion) : null))
const extras = computed(() => (bzRow.value ? getBzExtras(bzRow.value.champion) : null))
const displayText = computed(() => zhText.value ?? bzRow.value?.summary ?? '')
</script>

<style scoped></style>
