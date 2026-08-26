<template>
  <div
    v-if="session"
    class="mb-1 rounded-md bg-neutral-100 px-2 py-1.5 text-xs dark:bg-neutral-800/70"
  >
    <div class="flex items-center gap-1.5">
      <span class="font-bold text-black/80 dark:text-white/90">对位克制</span>
      <NSelect
        size="tiny"
        class="w-30!"
        :consistent-menu-width="false"
        :value="manualTarget"
        :options="targetOptions"
        @update:value="(v: number) => (manualTarget = v)"
      />
      <NSelect
        v-if="!assignedLane"
        size="tiny"
        class="w-22!"
        :consistent-menu-width="false"
        placeholder="我的分路"
        :value="manualLane"
        :options="laneOptions"
        @update:value="(v: string) => (manualLane = v)"
      />
      <NButton size="tiny" secondary :loading="isLoading" @click="() => refresh(true)">
        <template #icon>
          <NIcon><RefreshSharp /></NIcon>
        </template>
      </NButton>
      <span class="ml-auto text-[11px] text-black/45 dark:text-white/40">{{ statusText }}</span>
    </div>

    <div v-if="errorText" class="mt-1 text-[11px] text-red-500">{{ errorText }}</div>
    <div v-if="hoverNotice" class="mt-1 text-[11px] text-black/60 dark:text-white/60">
      {{ hoverNotice }}
    </div>

    <div v-else-if="resolvedTargetId && intel" class="mt-1.5 grid grid-cols-2 gap-2">
      <div>
        <div class="mb-0.5 flex items-center justify-between text-[11px] font-bold">
          <span>打他胜率</span>
          <span class="font-normal text-black/40 dark:text-white/35">高 → 低</span>
        </div>
        <NScrollbar class="max-h-45">
          <div
            v-for="row in winRateRows"
            :key="'w' + row.championId"
            class="flex items-center gap-1 py-0.5"
            :class="{ 'opacity-45': row.games < 50 }"
          >
            <ChampionIcon round class="size-4 shrink-0" :champion-id="row.championId" />
            <span class="min-w-0 flex-1 truncate">{{ championName(row.championId) }}</span>
            <span class="font-bold tabular-nums">{{ formatPercent(row.myWinRate) }}</span>
            <span class="w-9 text-right text-[10px] tabular-nums text-black/40 dark:text-white/35">
              {{ row.games }}场
            </span>
            <NButton
              v-if="canHover(row.championId)"
              size="tiny"
              tertiary
              class="ml-0.5 h-4.5! w-7! min-w-0 px-0!"
              title="选用该英雄（不会锁定）"
              @click="hoverChampion(row.championId)"
            >
              选
            </NButton>
            <span v-else class="ml-0.5 w-7 shrink-0"></span>
          </div>
        </NScrollbar>
      </div>
      <div>
        <div class="mb-0.5 flex items-center justify-between text-[11px] font-bold">
          <span>单杀他概率</span>
          <span class="font-normal text-black/40 dark:text-white/35">高 → 低</span>
        </div>
        <div
          v-if="!intel.laneKillAvailable"
          class="py-2 text-center text-[11px] text-black/40 dark:text-white/35"
        >
          数据源改版，暂不可用（胜率不受影响）
        </div>
        <NScrollbar v-else class="max-h-45">
          <div
            v-for="row in laneKillRows"
            :key="'k' + row.championId"
            class="flex items-center gap-1 py-0.5"
            :class="{ 'opacity-45': row.games < 50 }"
          >
            <ChampionIcon round class="size-4 shrink-0" :champion-id="row.championId" />
            <span class="min-w-0 flex-1 truncate">{{ championName(row.championId) }}</span>
            <span class="font-bold tabular-nums">
              {{ row.laneKillRate === null ? '—' : formatPercent(row.laneKillRate) }}
            </span>
            <span class="w-9 text-right text-[10px] tabular-nums text-black/40 dark:text-white/35">
              {{ row.games }}场
            </span>
            <NButton
              v-if="canHover(row.championId)"
              size="tiny"
              tertiary
              class="ml-0.5 h-4.5! w-7! min-w-0 px-0!"
              title="选用该英雄（不会锁定）"
              @click="hoverChampion(row.championId)"
            >
              选
            </NButton>
            <span v-else class="ml-0.5 w-7 shrink-0"></span>
          </div>
        </NScrollbar>
      </div>
    </div>

    <div v-else-if="isLoading" class="flex items-center justify-center py-3">
      <NSpin :size="14" />
    </div>

    <div v-else class="py-2 text-center text-[11px] text-black/40 dark:text-white/35">
      {{ placeholderText }}
    </div>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useInstance } from '@renderer-shared/shards'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { CHAMPION_DATA_MAIN_NAMESPACE } from '@renderer-shared/shards/champion-data/context'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import type { CounterIntelResult, RolePriors } from '@shared/types/counter-intel'
import { type LaneName, resolveLaneOpponent } from '@shared/utils/lane-assignment'
import { RefreshSharp } from '@vicons/ionicons5'
import { NButton, NIcon, NScrollbar, NSelect, NSpin } from 'naive-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useOpgg } from '../context'

const LANES: readonly LaneName[] = ['top', 'jungle', 'middle', 'bottom', 'utility']
const LANE_LABELS: Record<LaneName, string> = {
  top: '上路',
  jungle: '打野',
  middle: '中路',
  bottom: '下路',
  utility: '辅助'
}

const lcs = useLeagueClientStore()
const resources = useAkariResourceProvider()
const ipc = useInstance(AkariIpcRenderer)
const lc = useInstance(LeagueClientRenderer)
const { region, tier } = useOpgg()

const session = computed(() => lcs.champSelect.session)

// ===== 一键选用（不锁定）=====
const pickableIds = computed(() => lcs.champSelect.currentPickableChampionIds)

const myPickActionId = computed<string | number | null>(() => {
  const s = session.value
  if (!s) return null
  for (const group of s.actions) {
    for (const a of group) {
      if (a.actorCellId === s.localPlayerCellId && a.type === 'pick' && !a.completed) {
        return a.id
      }
    }
  }
  return null
})

function canHover(championId: number) {
  return myPickActionId.value !== null && pickableIds.value.has(championId)
}

const hoverNotice = ref('')
let hoverNoticeTimer: ReturnType<typeof setTimeout> | null = null
async function hoverChampion(championId: number) {
  const actionId = myPickActionId.value
  if (actionId === null) return
  try {
    await lc.api.champSelect.action(actionId, { championId, completed: false })
    hoverNotice.value = `已选择 ${championName(championId)}（未锁定，请自行确认）`
  } catch (error: any) {
    hoverNotice.value = `选择失败：${error?.response?.data?.message ?? error?.message ?? error}`
  }
  if (hoverNoticeTimer) clearTimeout(hoverNoticeTimer)
  hoverNoticeTimer = setTimeout(() => (hoverNotice.value = ''), 2500)
}

const enemyChampionIds = computed(() => {
  const s = session.value
  if (!s) return [] as number[]
  const ids = s.theirTeam
    .map((t) => t.championId || t.championPickIntent)
    .filter((c): c is number => typeof c === 'number' && c > 0)
  return [...new Set(ids)]
})

const assignedLane = computed<LaneName | ''>(() => {
  const s = session.value
  if (!s) return ''
  const me = s.myTeam.find((t) => t.cellId === s.localPlayerCellId)
  const pos = me?.assignedPosition ?? ''
  return (LANES as readonly string[]).includes(pos) ? (pos as LaneName) : ''
})

const manualLane = ref<string>('')
const effectiveLane = computed<LaneName | ''>(() => {
  if (assignedLane.value) return assignedLane.value
  return (LANES as readonly string[]).includes(manualLane.value)
    ? (manualLane.value as LaneName)
    : ''
})

const laneOptions = LANES.map((lane) => ({ label: LANE_LABELS[lane], value: lane }))

const manualTarget = ref<number>(0)
watch(enemyChampionIds, (ids) => {
  if (manualTarget.value > 0 && !ids.includes(manualTarget.value)) {
    manualTarget.value = 0
  }
})

function championName(championId: number) {
  return resources.champions.name(championId)
}

const targetOptions = computed(() => [
  { label: '自动判定对位', value: 0 },
  ...enemyChampionIds.value.map((id) => ({ label: championName(id), value: id }))
])

const priors = ref<RolePriors | null>(null)
let priorsKey = ''
async function ensurePriors() {
  const key = `${region.value}|${tier.value}`
  if (priors.value && priorsKey === key) return
  try {
    priors.value = await ipc.call<RolePriors>(
      CHAMPION_DATA_MAIN_NAMESPACE,
      'counterIntel/rolePriors',
      region.value,
      tier.value
    )
    priorsKey = key
  } catch {
    priors.value = priors.value ?? {}
  }
}

const autoResolution = computed(() => {
  if (!effectiveLane.value || enemyChampionIds.value.length === 0) return null
  const inputs = enemyChampionIds.value.map((id) => ({
    championId: id,
    roleRates: priors.value?.[id] ?? {}
  }))
  return resolveLaneOpponent(inputs, effectiveLane.value)
})

const resolvedTargetId = computed<number | null>(() => {
  if (manualTarget.value > 0 && enemyChampionIds.value.includes(manualTarget.value)) {
    return manualTarget.value
  }
  return autoResolution.value?.championId ?? null
})

const statusText = computed(() => {
  if (manualTarget.value > 0 && resolvedTargetId.value === manualTarget.value) {
    return `手动指定：${championName(manualTarget.value)}`
  }
  const auto = autoResolution.value
  if (auto?.championId) {
    return `自动判定：${championName(auto.championId)}（${Math.round(auto.probability * 100)}%）`
  }
  return ''
})

const placeholderText = computed(() => {
  if (!effectiveLane.value) return '未获取到你的分路，请在上方选择'
  if (enemyChampionIds.value.length === 0) return '等待对面选择英雄…'
  return '等待对位判定…'
})

const intel = ref<CounterIntelResult | null>(null)
const isLoading = ref(false)
const errorText = ref('')
let requestSeq = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null

async function fetchIntel() {
  const targetId = resolvedTargetId.value
  const lane = effectiveLane.value
  if (!targetId || !lane) {
    intel.value = null
    return
  }
  const seq = ++requestSeq
  isLoading.value = true
  errorText.value = ''
  try {
    await ensurePriors()
    const result = await ipc.call<CounterIntelResult>(
      CHAMPION_DATA_MAIN_NAMESPACE,
      'counterIntel/get',
      {
        championId: targetId,
        position: lane,
        region: region.value,
        tier: tier.value
      }
    )
    if (seq === requestSeq) {
      intel.value = result
    }
  } catch (error: any) {
    if (seq === requestSeq) {
      intel.value = null
      errorText.value = `获取失败：${error?.message ?? error}`
    }
  } finally {
    if (seq === requestSeq) {
      isLoading.value = false
    }
  }
}

function refresh(immediate = false) {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (immediate) {
    void fetchIntel()
  } else {
    debounceTimer = setTimeout(() => void fetchIntel(), 400)
  }
}

watch([resolvedTargetId, effectiveLane, () => region.value, () => tier.value], () => refresh())
watch(session, (s) => {
  if (s) {
    void ensurePriors()
  } else {
    intel.value = null
    errorText.value = ''
  }
})
if (session.value) {
  void ensurePriors()
  refresh()
}

onBeforeUnmount(() => {
  if (debounceTimer) clearTimeout(debounceTimer)
  if (hoverNoticeTimer) clearTimeout(hoverNoticeTimer)
})

const winRateRows = computed(() => {
  if (!intel.value) return []
  return [...intel.value.rows].sort((a, b) => b.myWinRate - a.myWinRate)
})

const laneKillRows = computed(() => {
  if (!intel.value) return []
  return [...intel.value.rows]
    .filter((row) => row.laneKillRate !== null)
    .sort((a, b) => (b.laneKillRate ?? 0) - (a.laneKillRate ?? 0))
})

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`
}
</script>
