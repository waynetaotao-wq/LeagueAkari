<template>
  <div
    v-if="session || inGameMatchup || hasCurrentMatchupLock"
    class="mb-1 rounded border border-black/10 p-2 last:mb-0 dark:border-[#37373c]"
  >
    <!-- 标题行（官方区块同款）：标题 + 摘要 + 展开开关 -->
    <div class="flex items-center justify-between text-[13px] font-bold">
      <div class="flex min-w-0 items-center gap-2">
        <span class="shrink-0">对位克制</span>
        <span class="min-w-0 truncate text-xs font-normal text-[#666666] dark:text-[#bebebe]">
          {{ summaryText }}
        </span>
      </div>
      <NSwitch
        size="small"
        v-model:value="expanded"
        :round="false"
        class="mr-2 shrink-0"
        :rail-style="({ checked }: any) => ({ backgroundColor: checked ? '#2a947d' : '#565660' })"
      >
        <template #checked>收起</template>
        <template #unchecked>展开</template>
      </NSwitch>
    </div>

    <template v-if="expanded">
      <!-- 控制行 -->
      <div class="mt-2 flex items-center gap-1.5">
        <NSelect
          size="tiny"
          class="w-30!"
          :consistent-menu-width="false"
          :value="manualTarget"
          :options="targetOptions"
          @update:value="updateManualTarget"
        />
        <NSelect
          v-if="!assignedLane"
          size="tiny"
          class="w-22!"
          :consistent-menu-width="false"
          placeholder="我的分路"
          :value="manualLane"
          :options="laneOptions"
          @update:value="updateManualLane"
        />
        <NButton size="tiny" secondary :loading="isLoading" @click="refreshAll">
          <template #icon>
            <NIcon><RefreshSharp /></NIcon>
          </template>
        </NButton>
        <span class="ml-auto min-w-0 truncate text-xs text-[#666666] dark:text-[#bebebe]">
          {{ statusText }}
        </span>
      </div>

      <!-- 对位替换（官方绿红开关样式） -->
      <div class="mt-1.5 flex items-center gap-1.5 text-xs">
        <span class="shrink-0 text-[#666666] dark:text-[#b2b2b2]">对位替换</span>
        <NSwitch
          size="small"
          :value="matchupOn"
          :round="false"
          :rail-style="({ checked }: any) => ({ backgroundColor: checked ? '#2a947d' : '#dc2626' })"
          @update:value="(v: boolean) => (matchupOn = v)"
        >
          <template #checked>开</template>
          <template #unchecked>关</template>
        </NSwitch>
        <span class="ml-auto min-w-0 truncate text-[#666666] dark:text-[#bebebe]">
          {{ matchupStatus }}
        </span>
      </div>

      <!-- 已替换区块诊断行：任一区块解析失败会显示为"未替换"，静默降级从此可见 -->
      <div v-if="matchupSections.length" class="mt-1 flex flex-wrap items-center gap-1 text-[10px]">
        <span class="text-[#666666] dark:text-[#b2b2b2]">有对位数据</span>
        <span
          v-for="k of matchupSections"
          :key="k"
          class="rounded bg-[#2a947d]/12 px-1 text-[#2a947d] dark:bg-[#5fd3a5]/12 dark:text-[#5fd3a5]"
        >
          {{ SECTION_LABELS[k] ?? k }}
        </span>
        <template v-if="missingSections.length">
          <span class="ml-1 text-[#666666] dark:text-[#b2b2b2]">对位无样本（已清空）</span>
          <span
            v-for="k of missingSections"
            :key="k"
            class="rounded bg-black/5 px-1 text-[#666666] dark:bg-white/8 dark:text-[#b2b2b2]"
          >
            {{ SECTION_LABELS[k] ?? k }}
          </span>
        </template>
      </div>

      <!-- Bz（欧服第一劫）攻略卡：命中时优先展示，与下方 OP.GG 量化数据共存 -->
      <div v-if="bzRow" class="mt-2 rounded border border-black/10 p-2 dark:border-[#37373c]">
        <div class="mb-1 flex items-center justify-between text-[12px] font-bold">
          <span>
            Bz 推荐
            <span class="font-normal text-[#666666] dark:text-[#bebebe]">（欧服第一劫）</span>
            · vs {{ bzRow.champion }}
          </span>
          <span
            v-if="bzRow.difficulty"
            class="text-[11px]"
            :class="
              /ff|impossible|hard/i.test(bzRow.difficulty)
                ? 'text-[#dc2626] dark:text-[#d75a5a]'
                : 'text-[#2a947d] dark:text-[#5fd3a5]'
            "
          >
            难度 {{ bzRow.difficulty }}
          </span>
        </div>
        <div v-if="bzExtras" class="mb-1 flex items-center gap-2">
          <span class="text-xs text-[#666666] dark:text-[#b2b2b2]">召唤师</span>
          <SummonerSpellDisplay
            v-for="(sid, i) of bzExtras.spellIds"
            :key="i"
            :spell-id="sid"
            :size="20"
          />
          <span class="ml-1 text-xs text-[#666666] dark:text-[#b2b2b2]">出门</span>
          <ItemDisplay :item-id="bzExtras.starterItemId" :size="20" />
        </div>
        <div v-if="bzRow.rune" class="text-xs whitespace-pre-line">
          <span class="text-[#666666] dark:text-[#b2b2b2]">符文：</span>{{ bzRow.rune }}
        </div>
        <div v-if="bzRow.coreBuild" class="mt-0.5 text-xs whitespace-pre-line">
          <span class="text-[#666666] dark:text-[#b2b2b2]">核心装：</span>{{ bzRow.coreBuild }}
        </div>
        <div
          v-if="bzRow.summary"
          class="mt-1 border-t border-black/5 pt-1 text-xs leading-relaxed whitespace-pre-line text-black/80 dark:border-white/8 dark:text-white/80"
        >
          {{ bzRow.summary }}
        </div>
        <div class="mt-1 text-[10px] text-[#666666]/80 dark:text-[#b2b2b2]/70">
          <template
            v-if="
              (bzRow.coreItemBuilds && bzRow.coreItemBuilds.length) ||
              (bzRow.coreItemIds && bzRow.coreItemIds.length)
            "
          >
            核心装已按 Bz 推荐置顶至下方“核心装备”区（人工推荐行不显示虚假胜率）；
          </template>
          <template v-if="bzExtras"> 召唤师技能与出门装同样已置顶至各自区块首行； </template>
          <template v-if="bzRow.keystonePerkId">
            <template v-if="bzRuneFilterStatus === 'filtered'">
              符文区已按 Bz 基石筛选流派（保留 OP.GG 完整页数据）；
            </template>
            <template v-else-if="bzRuneFilterStatus === 'already-matched'">
              OP.GG 符文页已全部匹配 Bz 基石；
            </template>
            <template v-else-if="bzRuneFilterStatus === 'missing-runes'">
              当前没有可供 Bz 筛选的 OP.GG 完整符文页；
            </template>
            <template v-else-if="bzRuneFilterStatus === 'no-match'">
              未找到匹配 Bz 基石的 OP.GG 完整符文页，本次未应用符文筛选；
            </template>
          </template>
          数据来自 Bz 的对线表（正常联网时更新最迟 10
          分钟内生效；源不可用时可能暂用旧缓存）；未收录的对线自动回落 OP.GG
        </div>
      </div>

      <div v-if="errorText" class="mt-1 text-xs text-[#dc2626] dark:text-[#d75a5a]">
        {{ errorText }}
      </div>
      <div v-if="hoverNotice" class="mt-1 text-xs text-[#666666] dark:text-[#bebebe]">
        {{ hoverNotice }}
      </div>

      <div v-else-if="resolvedTargetId && intel" class="mt-2 grid grid-cols-2 gap-2">
        <div>
          <div
            class="mb-1 flex items-center justify-between text-[10px] text-[#666666] dark:text-[#b2b2b2]"
          >
            <span>打他胜率</span>
            <span>高 → 低</span>
          </div>
          <NScrollbar class="max-h-100">
            <div
              v-for="row in winRateRows"
              :key="'w' + row.championId"
              class="mb-1 flex items-center gap-1 last:mb-0"
              :class="{ 'opacity-45': row.games < 50 }"
            >
              <ChampionIcon round class="size-5 shrink-0" :champion-id="row.championId" />
              <span class="min-w-0 flex-1 truncate text-xs">{{
                championName(row.championId)
              }}</span>
              <span
                class="text-xs font-bold tabular-nums"
                :class="
                  row.myWinRate > 0.5
                    ? 'text-[#2a947d] dark:text-[#5fd3a5]'
                    : 'text-[#dc2626] dark:text-[#d75a5a]'
                "
                >{{ formatPercent(row.myWinRate) }}</span
              >
              <span
                class="w-9 text-right text-[10px] text-[#666666] tabular-nums dark:text-[#b2b2b2]"
              >
                {{ row.games }}场
              </span>
              <NButton
                v-if="canHover(row.championId)"
                size="tiny"
                type="primary"
                secondary
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
          <div
            class="mb-1 flex items-center justify-between text-[10px] text-[#666666] dark:text-[#b2b2b2]"
          >
            <span>单杀他概率</span>
            <span>高 → 低</span>
          </div>
          <div
            v-if="!intel.laneKillAvailable"
            class="py-2 text-center text-xs text-[#666666] dark:text-[#b2b2b2]"
          >
            数据源改版，暂不可用（胜率不受影响）
          </div>
          <NScrollbar v-else class="max-h-100">
            <div
              v-for="row in laneKillRows"
              :key="'k' + row.championId"
              class="mb-1 flex items-center gap-1 last:mb-0"
              :class="{ 'opacity-45': row.games < 50 }"
            >
              <ChampionIcon round class="size-5 shrink-0" :champion-id="row.championId" />
              <span class="min-w-0 flex-1 truncate text-xs">{{
                championName(row.championId)
              }}</span>
              <span
                class="text-xs font-bold tabular-nums"
                :class="
                  row.laneKillRate === null
                    ? ''
                    : row.laneKillRate > 0.5
                      ? 'text-[#2a947d] dark:text-[#5fd3a5]'
                      : 'text-[#dc2626] dark:text-[#d75a5a]'
                "
              >
                {{ row.laneKillRate === null ? '—' : formatPercent(row.laneKillRate) }}
              </span>
              <span
                class="w-9 text-right text-[10px] text-[#666666] tabular-nums dark:text-[#b2b2b2]"
              >
                {{ row.games }}场
              </span>
              <NButton
                v-if="canHover(row.championId)"
                size="tiny"
                type="primary"
                secondary
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

      <div v-else class="py-2 text-center text-xs text-[#666666] dark:text-[#b2b2b2]">
        {{ placeholderText }}
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { getBzExtras } from '@renderer-shared/components/ongoing-game-panel/widgets/player-info-card/bz-summary-zh'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import ItemDisplay from '@renderer-shared/components/widgets/ItemDisplay.vue'
import SummonerSpellDisplay from '@renderer-shared/components/widgets/SummonerSpellDisplay.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useInstance } from '@renderer-shared/shards'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { CHAMPION_DATA_MAIN_NAMESPACE } from '@renderer-shared/shards/champion-data/context'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import type {
  BzGuideResult,
  BzMatchupRow,
  CounterIntelResult,
  MatchupBuildResult,
  RolePriors
} from '@shared/types/counter-intel'
import { type LaneName, resolveLaneOpponent } from '@shared/utils/lane-assignment'
import { RefreshSharp } from '@vicons/ionicons5'
import { NButton, NIcon, NScrollbar, NSelect, NSpin, NSwitch } from 'naive-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useOpgg } from '../context'
import { type BzRuneFilterStatus, mergeBzIntoOverlay } from '../bz-overlay'
import {
  areSameMatchupSession,
  createMatchupRequestToken,
  isCurrentMatchupGameData,
  isCurrentMatchupRequest,
  matchupSessionIdentityKey,
  observeMatchupSession,
  resolveAssignedLaneOpponent,
  resolveMatchupCorrectionDisposition,
  resolveMatchupSessionIdentity,
  resolveRealMatchupValidation,
  resolveScopedMatchupTarget,
  type MatchupLifecycleState,
  type MatchupRequestToken,
  type MatchupSessionIdentity
} from '../matchup-lifecycle'
import {
  type MatchupOverlayIdentity,
  hasCompleteMatchupLoadout,
  matchesMatchupOverlayIdentity,
  opggPositionToMatchupLane,
  useMatchupOverlay
} from '../matchup-overlay'

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
const {
  region,
  tier,
  championId: myChampionId,
  mode: opggMode,
  position: opggPosition,
  version: opggVersion,
  effectiveSource,
  syncAutomaticLoadout,
  setMatchupLoadoutPending,
  changePosition
} = useOpgg()

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
const LANE_TO_OPGG_POSITION = {
  top: 'top',
  jungle: 'jungle',
  middle: 'mid',
  bottom: 'adc',
  utility: 'support'
} as const satisfies Record<LaneName, 'top' | 'jungle' | 'mid' | 'adc' | 'support'>

function updateManualLane(value: string) {
  if (!(LANES as readonly string[]).includes(value)) return
  const lane = value as LaneName
  manualLane.value = lane
  void changePosition(LANE_TO_OPGG_POSITION[lane]).then(() => syncAutomaticLoadout())
}

const effectiveLane = computed<LaneName | ''>(() => {
  if (assignedLane.value) return assignedLane.value
  return (LANES as readonly string[]).includes(manualLane.value)
    ? (manualLane.value as LaneName)
    : ''
})

const laneOptions = LANES.map((lane) => ({ label: LANE_LABELS[lane], value: lane }))

const manualTarget = ref<number>(0)
const manualTargetOwner = ref<MatchupSessionIdentity | null>(null)
const observedMatchupSession = computed(() =>
  resolveMatchupSessionIdentity({
    phase: lcs.gameflow.phase,
    champSelectSession: session.value,
    gameflowSession: lcs.gameflow.session
  })
)
const observedMatchupSessionKey = computed(() =>
  matchupSessionIdentityKey(observedMatchupSession.value)
)

function updateManualTarget(value: number) {
  const target = Number(value)
  manualTarget.value = Number.isInteger(target) && target > 0 ? target : 0
  manualTargetOwner.value =
    manualTarget.value > 0 && observedMatchupSession.value
      ? { ...observedMatchupSession.value }
      : null
}

watch(enemyChampionIds, (ids) => {
  if (manualTarget.value > 0 && !ids.includes(manualTarget.value)) {
    updateManualTarget(0)
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
let priorsSeq = 0
let priorsInFlight: { key: string; request: Promise<RolePriors> } | null = null
let priorsRetryKey = ''
let priorsRetryAt = 0
const PRIORS_RETRY_DELAY_MS = 3000

function currentPriorsKey() {
  return `${region.value}|${tier.value}|${opggVersion.value ?? 'latest'}`
}

async function ensurePriors(forceRetry = false) {
  const key = currentPriorsKey()
  if (priors.value && priorsKey === key) return
  // champ-select session 会随计时器频繁推送；同口径请求必须复用，不能每秒把前一次作废。
  if (priorsInFlight?.key === key) return
  if (!forceRetry && priorsRetryKey === key && Date.now() < priorsRetryAt) return
  const seq = ++priorsSeq
  // 新口径到达前不允许继续用旧版本/旧地区的分路先验猜对手。
  if (priorsKey !== key) {
    priors.value = null
    priorsKey = ''
  }
  const request = ipc.call<RolePriors>(
    CHAMPION_DATA_MAIN_NAMESPACE,
    'counterIntel/rolePriors',
    region.value,
    tier.value,
    opggVersion.value
  )
  priorsInFlight = { key, request }
  try {
    const loaded = await request
    if (seq !== priorsSeq || key !== currentPriorsKey()) return
    priors.value = loaded
    priorsKey = key
    priorsRetryKey = ''
    priorsRetryAt = 0
  } catch {
    if (seq === priorsSeq && key === currentPriorsKey()) {
      priors.value = null
      priorsKey = ''
      priorsRetryKey = key
      priorsRetryAt = Date.now() + PRIORS_RETRY_DELAY_MS
    }
  } finally {
    if (priorsInFlight?.request === request) priorsInFlight = null
  }
}

const autoResolution = computed(() => {
  if (!effectiveLane.value || enemyChampionIds.value.length === 0) return null
  const assignedOpponent = resolveAssignedLaneOpponent(
    session.value?.theirTeam ?? [],
    effectiveLane.value
  )
  if (assignedOpponent) {
    return { championId: assignedOpponent, probability: 1, exactPosition: true }
  }
  if (!priors.value) return null
  const inputs = enemyChampionIds.value.map((id) => ({
    championId: id,
    roleRates: priors.value?.[id] ?? {}
  }))
  return { ...resolveLaneOpponent(inputs, effectiveLane.value), exactPosition: false }
})

const targetResolution = computed(() =>
  resolveScopedMatchupTarget({
    currentSession: observedMatchupSession.value,
    manualTarget:
      manualTarget.value > 0 && manualTargetOwner.value
        ? { championId: manualTarget.value, owner: manualTargetOwner.value }
        : null,
    enemyChampionIds: enemyChampionIds.value,
    automaticResolution: autoResolution.value
  })
)

const resolvedTargetId = computed<number | null>(() => targetResolution.value?.championId ?? null)

const statusText = computed(() => {
  const resolution = targetResolution.value
  if (!resolution) return ''
  if (resolution.source === 'manual') {
    return `手动指定：${championName(resolution.championId)}`
  }
  if (autoResolution.value?.exactPosition) {
    return `自动判定：${championName(resolution.championId)}（客户端分路）`
  }
  return `自动判定：${championName(resolution.championId)}（${Math.round((resolution.probability ?? 0) * 100)}%）`
})

const placeholderText = computed(() => {
  if (!effectiveLane.value) return '未获取到你的分路，请在上方选择'
  if (enemyChampionIds.value.length === 0) return '等待对面选择英雄…'
  return '等待对位判定…'
})

// ===== [lolps] 对位数据整窗替换 =====
// 识别到对位后拉取官方形状 overlay 写入共享状态；OpggView 就近 provide 覆盖 champion，
// 原界面所有区块（符文/召唤师/技能/出装）与"应用"按钮自动切换为对位版数据。
const {
  matchupOverlayIdentity,
  matchupRefreshGeneration,
  resolveMatchupLoadoutSource,
  setMatchupOverlay
} = useMatchupOverlay()
// [lolps] 默认折叠为一行摘要，不遮挡下方符文/出装区块
const expanded = ref(false)

const matchupOn = ref(true)
const matchupStatus = ref('')

/** 区块键 → 中文标签（诊断行用） */
const SECTION_LABELS: Record<string, string> = {
  runes: '符文',
  summoner_spells: '召唤师',
  skill_masteries: '技能加点',
  starter_items: '出门装',
  boots: '鞋',
  core_items: '核心装',
  last_items: '后续装备汇总'
}
const ALL_SECTIONS = [
  'summoner_spells',
  'runes',
  'skill_masteries',
  'starter_items',
  'boots',
  'core_items',
  'last_items'
]
/** 本次对位实际替换成功的区块（含 Bz 并入项） */
const matchupSections = ref<string[]>([])
const missingSections = computed(() =>
  matchupSections.value.length ? ALL_SECTIONS.filter((k) => !matchupSections.value.includes(k)) : []
)
let matchupSeq = 0
let matchupTimer: ReturnType<typeof setTimeout> | null = null
let validateTimer: ReturnType<typeof setInterval> | null = null
let matchupLifecycle: MatchupLifecycleState = {
  current: null,
  lastKnown: null,
  generation: 0
}

const intel = ref<CounterIntelResult | null>(null)
const isLoading = ref(false)
const errorText = ref('')
let requestSeq = 0
let debounceTimer: ReturnType<typeof setTimeout> | null = null

/** [lolps] 对位锁定态：选人期挂上对位构筑后，整个对局周期内保持不还原 */
const matchupLock = ref<{
  owner: MatchupSessionIdentity
  myChampionId: number
  opponentChampionId: number
  lane: LaneName
  validated: boolean
} | null>(null)
const hasCurrentMatchupLock = computed(
  () =>
    !!matchupLock.value &&
    areSameMatchupSession(matchupLock.value.owner, observedMatchupSession.value)
)

type MatchupQuerySnapshot = Pick<
  MatchupOverlayIdentity,
  'region' | 'tier' | 'version' | 'mode' | 'source'
>

function currentMatchupQuery(): MatchupQuerySnapshot {
  return {
    region: String(region.value),
    tier: String(tier.value),
    version: opggVersion.value,
    mode: String(opggMode.value),
    source: String(effectiveSource.value ?? 'unknown')
  }
}

function sameLockedIdentity(
  left: Pick<MatchupOverlayIdentity, 'myChampionId' | 'opponentChampionId' | 'lane'>,
  right: Pick<MatchupOverlayIdentity, 'myChampionId' | 'opponentChampionId' | 'lane'>
) {
  return (
    left.myChampionId === right.myChampionId &&
    left.opponentChampionId === right.opponentChampionId &&
    left.lane === right.lane
  )
}

/** [lolps] Bz（欧服第一劫）攻略：我方为劫且对位命中其表时展示（自动跟随其表更新） */
const ZED_ID = 238
const bzRow = ref<BzMatchupRow | null>(null)
const bzSourceUnavailable = ref(false)
const bzRuneFilterStatus = ref<BzRuneFilterStatus>('not-requested')
const bzExtras = computed(() => (bzRow.value ? getBzExtras(bzRow.value.champion) : null))

/** 流水线内查询：仅劫生效；源故障单独标记，不中断 OP.GG 主链路。 */
async function fetchBzRow(
  me: number,
  opp: number
): Promise<{ row: BzMatchupRow | null; sourceUnavailable: boolean }> {
  if (me !== ZED_ID || !opp) return { row: null, sourceUnavailable: false }
  try {
    const res = await ipc.call<BzGuideResult>(
      CHAMPION_DATA_MAIN_NAMESPACE,
      'counterIntel/bzGuide',
      { opponentChampionId: opp }
    )
    return {
      row: res?.found ? res.row : null,
      sourceUnavailable: res?.reason === 'source-unavailable'
    }
  } catch {
    return { row: null, sourceUnavailable: true }
  }
}

/** 视为"对局进行中"的阶段（含加载与断线重连）；只锁英雄身份，筛选仍可刷新。 */
const IN_GAME_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect'])
/** LaneName ↔ LCU 位置串（键必须与 LANES 一致：top/jungle/middle/bottom/utility） */
const LANE_TO_LCU: Record<string, string> = {
  top: 'TOP',
  jungle: 'JUNGLE',
  middle: 'MIDDLE',
  bottom: 'BOTTOM',
  utility: 'UTILITY'
}
const LCU_TO_LANE: Record<string, LaneName> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MIDDLE: 'middle',
  BOTTOM: 'bottom',
  UTILITY: 'utility'
}

/**
 * [lolps] 对局内对位来源：选人结束后 champSelect.session 消失，
 * 改从 gameflow 的真实双方阵容推导「我的英雄 / 我的分路 / 同路敌人」，
 * 使得——即便选人期没开过 OP.GG 窗口——进游戏后打开也能拿到对位构筑。
 */
const inGameMatchup = computed<{
  me: number
  opp: number
  lane: LaneName
  validated: boolean
} | null>(() => {
  // gameData 在结算/大厅可能仍残留上一局；非进行中阶段绝不能让旧对位复活。
  if (!IN_GAME_PHASES.has(String(lcs.gameflow.phase))) return null
  const gd = (lcs.gameflow.session as any)?.gameData
  const myPuuid = lcs.summoner.me?.puuid
  if (!gd || !myPuuid) return null
  if (!isCurrentMatchupGameData(observedMatchupSession.value, gd.gameId)) return null
  const one: any[] = Array.isArray(gd.teamOne) ? gd.teamOne : []
  const two: any[] = Array.isArray(gd.teamTwo) ? gd.teamTwo : []
  const mine = one.some((x) => x?.puuid === myPuuid)
    ? one
    : two.some((x) => x?.puuid === myPuuid)
      ? two
      : null
  if (!mine) return null
  const enemy = mine === one ? two : one
  const meEntry = mine.find((x) => x?.puuid === myPuuid)
  const me = Number(meEntry?.championId ?? 0)
  const lane =
    LCU_TO_LANE[String(meEntry?.selectedPosition ?? '').toUpperCase()] ??
    opggPositionToMatchupLane(opggPosition.value)
  if (!me || !lane) return null
  const sameLane = enemy.filter(
    (x) => String(x?.selectedPosition ?? '').toUpperCase() === LANE_TO_LCU[lane]
  )
  if (sameLane.length === 1) {
    const opp = Number(sameLane[0]?.championId ?? 0)
    if (opp > 0 && opp !== me) return { me, opp, lane, validated: true }
  }

  // 真实位置尚未填好时仍可按本局敌方阵容 + 当前口径分路先验推测；稍后轮询会精确纠正。
  if (!priors.value) return null
  const enemyIds = enemy
    .map((x) => Number(x?.championId ?? 0))
    .filter((id) => Number.isInteger(id) && id > 0 && id !== me)
  if (!enemyIds.length) return null
  const inferred = resolveLaneOpponent(
    [...new Set(enemyIds)].map((id) => ({ championId: id, roleRates: priors.value?.[id] ?? {} })),
    lane
  )
  return inferred.championId ? { me, opp: inferred.championId, lane, validated: false } : null
})
const inGameMatchupKey = computed(() => {
  const matchup = inGameMatchup.value
  return matchup
    ? `${matchup.me}|${matchup.opp}|${matchup.lane}|${matchup.validated ? 'verified' : 'inferred'}`
    : ''
})

const summaryText = computed(() => {
  if (bzRow.value) {
    return `Bz 推荐已就绪 vs ${bzRow.value.champion}${matchupStatus.value ? ` · ${matchupStatus.value}` : ''}`
  }
  if (matchupStatus.value) return matchupStatus.value
  if (resolvedTargetId.value && statusText.value) return statusText.value
  return '等待对位确认'
})

function stopMatchupTimer() {
  if (matchupTimer) {
    clearTimeout(matchupTimer)
    matchupTimer = null
  }
}

/** 只撤下数据快照；筛选刷新/临时失败时保留已校验的英雄与对手锁。 */
function clearMatchupOverlay(status = '') {
  bzRow.value = null
  bzSourceUnavailable.value = false
  bzRuneFilterStatus.value = 'not-requested'
  matchupSections.value = []
  setMatchupLoadoutPending(false)
  setMatchupOverlay(null)
  syncAutomaticLoadout()
  matchupStatus.value = status
}

/** 仅在身份真正失效（对局结束、卸载或真实阵容不符）时调用。 */
function resetMatchupState(status = '') {
  matchupLock.value = null
  clearMatchupOverlay(status)
}

function resetScopedMatchupState(status = '') {
  stopMatchupTimer()
  stopValidateLoop()
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (hoverNoticeTimer) {
    clearTimeout(hoverNoticeTimer)
    hoverNoticeTimer = null
  }
  matchupSeq++
  requestSeq++
  updateManualTarget(0)
  manualLane.value = ''
  hoverNotice.value = ''
  intel.value = null
  isLoading.value = false
  errorText.value = ''
  resetMatchupState(status)
}

// KeepAlive 下组件不会在两局之间卸载；以 session.id + gameId 同步切断上一局全部状态。
watch(
  observedMatchupSession,
  (next) => {
    const observed = observeMatchupSession(matchupLifecycle, next)
    matchupLifecycle = observed.state
    if (observed.startedNewSession) resetScopedMatchupState()
  },
  { immediate: true, flush: 'sync' }
)

async function loadMatchupForIdentity(
  me: number,
  opp: number,
  lane: LaneName,
  seq: number,
  options: {
    validated: boolean
    corrected?: boolean
    force?: boolean
    query: MatchupQuerySnapshot
    requestToken: MatchupRequestToken
  }
): Promise<boolean> {
  bzSourceUnavailable.value = false
  const [matchupOutcome, bzOutcome] = await Promise.all([
    ipc
      .call<MatchupBuildResult>(CHAMPION_DATA_MAIN_NAMESPACE, 'counterIntel/matchupBuild', {
        myChampionId: me,
        opponentChampionId: opp,
        position: lane,
        region: options.query.region,
        tier: options.query.tier,
        version: options.query.version,
        force: options.force
      })
      .then((result) => ({ result, error: null }))
      .catch((error: unknown) => ({ result: null, error })),
    fetchBzRow(me, opp)
  ])
  const identity: MatchupOverlayIdentity = {
    gameId: options.requestToken.owner.gameId!,
    myChampionId: me,
    opponentChampionId: opp,
    lane,
    ...options.query
  }
  const currentIdentity = resolveMatchupRequestIdentity()
  if (
    seq !== matchupSeq ||
    !isCurrentMatchupRequest(options.requestToken, matchupLifecycle) ||
    !matchupOn.value ||
    currentIdentity.me !== me ||
    currentIdentity.opp !== opp ||
    currentIdentity.lane !== lane ||
    !matchesMatchupOverlayIdentity(me, identity, {
      gameId: observedMatchupSession.value?.gameId ?? null,
      opponentChampionId: currentIdentity.opp,
      lane: opggPositionToMatchupLane(opggPosition.value),
      ...currentMatchupQuery()
    })
  ) {
    return false
  }

  const rawResult = matchupOutcome.result
  const resultMatchesRequest =
    !!rawResult &&
    rawResult.targetVerified &&
    rawResult.myChampionId === me &&
    rawResult.opponentChampionId === opp &&
    rawResult.position === lane &&
    rawResult.region === options.query.region &&
    String(rawResult.tier) === options.query.tier &&
    rawResult.version === options.query.version
  const result = resultMatchesRequest ? rawResult : null
  const resultError =
    matchupOutcome.error ??
    (rawResult && !resultMatchesRequest ? new Error('OP.GG 对位响应身份或样本校验未通过') : null)
  const bz = bzOutcome.row
  setMatchupLoadoutPending(false)
  bzSourceUnavailable.value = bzOutcome.sourceUnavailable
  bzRow.value = bz
  const merged = mergeBzIntoOverlay(result?.overlay ?? null, bz)
  bzRuneFilterStatus.value = merged.runeFilterStatus
  matchupSections.value = [...new Set([...(result?.parsedSections ?? []), ...merged.sections])]

  if (merged.overlay) {
    const metaText =
      result?.meta && result.meta.play > 0
        ? `${result.meta.play} 场 · 胜率 ${((result.meta.win / result.meta.play) * 100).toFixed(1)}%`
        : ''
    setMatchupOverlay(
      merged.overlay,
      metaText,
      identity,
      result?.meta ? { ...result.meta, sourceVersion: result.sourceVersion } : null,
      resolveMatchupLoadoutSource(!!result?.overlay, !!bz) ?? 'OP.GG'
    )
    const previousLock = matchupLock.value
    matchupLock.value = {
      owner: { ...options.requestToken.owner },
      myChampionId: me,
      opponentChampionId: opp,
      lane,
      validated:
        options.validated ||
        (!!previousLock &&
          areSameMatchupSession(previousLock.owner, options.requestToken.owner) &&
          sameLockedIdentity(previousLock, identity) &&
          previousLock.validated)
    }
    if (IN_GAME_PHASES.has(String(lcs.gameflow.phase)) && !matchupLock.value.validated) {
      startValidateLoop()
    }
    syncAutomaticLoadout()

    const opponentText = championName(opp)
    const sectionText = `${matchupSections.value.length}/${ALL_SECTIONS.length} 项`
    const autoApplyNotice = hasCompleteMatchupLoadout(merged.overlay)
      ? ''
      : ' · 自动应用回退当前通用构筑'
    const opggText = result?.overlay
      ? `OP.GG${metaText ? ` · ${metaText}` : ''} · ${sectionText}`
      : resultError
        ? 'OP.GG 获取失败，已降级'
        : 'OP.GG 该对位样本不足'
    if (bz) {
      const changedLabels = merged.sections.map((section) => SECTION_LABELS[section] ?? section)
      const bzAction = changedLabels.length
        ? `Bz 推荐已处理（${changedLabels.join('/')}）`
        : 'Bz 推荐与当前首选一致'
      const runeNotice =
        merged.runeFilterStatus === 'no-match'
          ? ' · 未找到同基石完整符文页，符文保留 OP.GG'
          : merged.runeFilterStatus === 'missing-runes'
            ? ' · 暂无可筛选的完整符文页'
            : ''
      matchupStatus.value = options.corrected
        ? `已按真实阵容修正对位 vs ${opponentText} · ${bzAction}（${opggText}）${runeNotice}${autoApplyNotice}`
        : `${bzAction} · 对位构筑 vs ${opponentText}（${opggText}）${runeNotice}${autoApplyNotice}`
    } else {
      const bzNotice = bzSourceUnavailable.value ? ' · BZ 数据源暂不可用' : ''
      const switchText =
        matchupSections.value.length === ALL_SECTIONS.length
          ? '已切换完整对位构筑'
          : `已切换部分对位构筑（${sectionText}）`
      matchupStatus.value = options.corrected
        ? `已按真实阵容修正对位 vs ${opponentText}（${opggText}）${bzNotice}${autoApplyNotice}`
        : `${switchText} vs ${opponentText}（${opggText}）${bzNotice}${autoApplyNotice}`
    }
    return true
  }

  if (!IN_GAME_PHASES.has(String(lcs.gameflow.phase))) matchupLock.value = null
  clearMatchupOverlay(
    resultError
      ? `对位数据获取失败：${(resultError as any)?.message ?? resultError}`
      : bzSourceUnavailable.value
        ? '该对位暂无 OP.GG 样本，且 BZ 数据源暂不可用，显示通用构筑'
        : '该对位样本不足，显示通用构筑'
  )
  return false
}

function resolveMatchupRequestIdentity() {
  const inGame = IN_GAME_PHASES.has(String(lcs.gameflow.phase))
  const currentSession = matchupLifecycle.current
  const locked =
    inGame && matchupLock.value && areSameMatchupSession(matchupLock.value.owner, currentSession)
      ? matchupLock.value
      : null
  const fromGame = inGameMatchup.value
  return {
    // 真实 gameData 完整可用时优先于选人期推测锁；锁只用于阵容尚未到达的短暂窗口。
    me: fromGame?.me || locked?.myChampionId || myChampionId.value || 0,
    opp: fromGame?.opp || locked?.opponentChampionId || resolvedTargetId.value || 0,
    lane: fromGame?.lane || locked?.lane || effectiveLane.value || '',
    validated: fromGame?.validated ?? locked?.validated ?? false
  }
}

async function refreshMatchupOverlay(force = false) {
  const { me, opp, lane, validated } = resolveMatchupRequestIdentity()
  const requestToken = createMatchupRequestToken(matchupLifecycle)
  const query = currentMatchupQuery()
  const baseLane = opggPositionToMatchupLane(opggPosition.value)
  if (
    !matchupOn.value ||
    opggMode.value !== 'ranked' ||
    !effectiveSource.value ||
    !requestToken ||
    !requestToken.owner.gameId ||
    !query.region ||
    !query.tier ||
    !me ||
    !opp ||
    !lane ||
    baseLane !== lane ||
    me === opp
  ) {
    matchupSeq++
    const status = !matchupOn.value
      ? '对位替换已关闭，显示通用构筑'
      : opggMode.value !== 'ranked'
        ? '当前模式无对位数据，显示通用构筑'
        : !effectiveSource.value
          ? '等待基础数据筛选就绪…'
          : lane && baseLane !== lane
            ? '英雄详情分路与真实对位分路不一致，显示通用构筑'
            : ''
    if (
      IN_GAME_PHASES.has(String(lcs.gameflow.phase)) &&
      matchupLock.value &&
      areSameMatchupSession(matchupLock.value.owner, matchupLifecycle.current)
    ) {
      clearMatchupOverlay(status)
    } else {
      resetMatchupState(status)
    }
    return
  }

  const matchupLane = lane as LaneName
  const expectedIdentity: MatchupOverlayIdentity = {
    gameId: requestToken.owner.gameId,
    myChampionId: me,
    opponentChampionId: opp,
    lane: matchupLane,
    ...query
  }
  if (!force && matchesMatchupOverlayIdentity(me, matchupOverlayIdentity.value, expectedIdentity)) {
    setMatchupLoadoutPending(false)
    return
  }

  const seq = ++matchupSeq
  await loadMatchupForIdentity(me, opp, matchupLane, seq, {
    validated,
    force,
    query,
    requestToken
  })
}

function scheduleMatchupOverlay(force = false) {
  stopMatchupTimer()

  if (!matchupOn.value) {
    matchupSeq++
    if (IN_GAME_PHASES.has(String(lcs.gameflow.phase)) && matchupLock.value) {
      clearMatchupOverlay('对位替换已关闭，显示通用构筑')
    } else {
      resetMatchupState('对位替换已关闭，显示通用构筑')
    }
    return
  }

  const { me, opp, lane } = resolveMatchupRequestIdentity()
  const requestToken = createMatchupRequestToken(matchupLifecycle)
  const query = currentMatchupQuery()
  const baseLane = opggPositionToMatchupLane(opggPosition.value)
  if (
    !force &&
    me &&
    opp &&
    lane &&
    requestToken?.owner.gameId &&
    baseLane === lane &&
    matchesMatchupOverlayIdentity(me, matchupOverlayIdentity.value, {
      gameId: requestToken.owner.gameId,
      opponentChampionId: opp,
      lane: baseLane,
      ...query
    })
  ) {
    return
  }

  // 依赖一变化就立刻让旧请求失效并撤下旧 overlay，不能在 500ms 防抖期间继续展示/应用。
  matchupSeq++
  if (!IN_GAME_PHASES.has(String(lcs.gameflow.phase))) matchupLock.value = null
  clearMatchupOverlay('正在获取对位构筑…')
  setMatchupLoadoutPending(true)
  if (force) {
    void refreshMatchupOverlay(true)
    return
  }
  matchupTimer = setTimeout(() => {
    matchupTimer = null
    void refreshMatchupOverlay()
  }, 500)
}

watch(
  [
    () => myChampionId.value,
    resolvedTargetId,
    effectiveLane,
    () => region.value,
    () => tier.value,
    () => opggMode.value,
    () => opggPosition.value,
    () => opggVersion.value,
    () => effectiveSource.value,
    matchupOn,
    observedMatchupSessionKey,
    inGameMatchupKey
  ],
  () => scheduleMatchupOverlay(),
  { immediate: true }
)

// 原版顶部刷新成功后也强制刷新克制表与对位数据，不能只更新通用英雄详情。
watch(matchupRefreshGeneration, () => refreshAll())

/** 进入加载/对局后：用真实双方阵容校验选人期的对位推测，必要时精确重定或诚实回退 */
async function validateMatchupAgainstRealTeams() {
  if (!matchupOn.value) return
  const lock = matchupLock.value
  const requestToken = createMatchupRequestToken(matchupLifecycle)
  if (!lock) return
  if (!requestToken || !areSameMatchupSession(lock.owner, requestToken.owner)) {
    resetMatchupState()
    return
  }
  if (lock.validated) return
  const gd = (lcs.gameflow.session as any)?.gameData
  // GameStart 时 gameData 可能仍是上一局；此时等待本局数据，不能误删当前局正确锁。
  if (!isCurrentMatchupGameData(requestToken.owner, gd?.gameId)) return
  const one: any[] = gd?.teamOne ?? []
  const two: any[] = gd?.teamTwo ?? []
  if (!one.length && !two.length) return // 阵容尚未就绪，等下一次相位变化再试
  const inTeam = (t: any[]) => t.some((x) => x?.championId === lock.myChampionId)
  const enemyTeam = inTeam(one) ? two : inTeam(two) ? one : null
  if (!enemyTeam || !enemyTeam.length) return
  const validation = resolveRealMatchupValidation(enemyTeam, lock.lane, lock.opponentChampionId)
  if (validation.status === 'confirmed') {
    lock.validated = true
    matchupStatus.value = `已确认真实对位 vs ${championName(lock.opponentChampionId)}，对位构筑锁定至对局结束`
    return
  }
  if (validation.status === 'waiting') {
    matchupStatus.value = `本局推测对位 vs ${championName(lock.opponentChampionId)}，等待客户端真实分路确认`
    return
  }

  if (validation.status === 'corrected' && validation.opponentChampionId) {
    const newOpp = validation.opponentChampionId
    const seq = ++matchupSeq
    // 已证明旧推测不对时必须先撤下，不能让网络窗口内的旧对手数据继续显示/可应用。
    clearMatchupOverlay(`正在按真实阵容修正对位 vs ${championName(newOpp)}…`)
    setMatchupLoadoutPending(true)
    const corrected = await loadMatchupForIdentity(lock.myChampionId, newOpp, lock.lane, seq, {
      validated: true,
      corrected: true,
      query: currentMatchupQuery(),
      requestToken
    })
    const disposition = resolveMatchupCorrectionDisposition({
      requestSequence: seq,
      currentSequence: matchupSeq,
      applied: corrected
    })
    if (disposition === 'superseded' || disposition === 'applied') return
    stopValidateLoop()
    resetMatchupState(`已确认真实对位 vs ${championName(newOpp)}，但暂无可用对位构筑，显示通用构筑`)
  }
}

/**
 * 校验轮询：相位刚跳进加载时客户端的真实阵容常未填充（英雄 id 暂为 0），
 * 一次性尝试会永远错过——改为每 3 秒重试，直到校验完成 / 锁失效 / 超时约 2 分钟。
 */
function stopValidateLoop() {
  if (validateTimer) {
    clearInterval(validateTimer)
    validateTimer = null
  }
}

function startValidateLoop() {
  stopValidateLoop()
  if (!matchupOn.value) return
  let tries = 0
  validateTimer = setInterval(() => {
    tries++
    const lock = matchupLock.value
    if (
      !matchupOn.value ||
      !lock ||
      !areSameMatchupSession(lock.owner, matchupLifecycle.current) ||
      lock.validated ||
      tries > 40 ||
      !IN_GAME_PHASES.has(String(lcs.gameflow.phase))
    ) {
      stopValidateLoop()
      return
    }
    void validateMatchupAgainstRealTeams()
  }, 3000)
  void validateMatchupAgainstRealTeams()
}

watch(matchupOn, (enabled) => {
  if (!enabled) {
    stopValidateLoop()
  } else if (IN_GAME_PHASES.has(String(lcs.gameflow.phase))) {
    startValidateLoop()
  }
})

watch(
  () => lcs.gameflow.phase,
  (p, previous) => {
    const phase = String(p)
    if (IN_GAME_PHASES.has(phase)) {
      void ensurePriors()
      startValidateLoop()
    } else if (phase === 'ChampSelect') {
      stopValidateLoop()
      if (previous !== undefined && previous !== null && String(previous) !== 'ChampSelect') {
        resetScopedMatchupState()
        scheduleMatchupOverlay()
      }
      void ensurePriors()
    } else {
      // Lobby/排队/秒退/错误结束都属于非活跃对局，不能只赌一定收到 EndOfGame/None。
      resetScopedMatchupState()
    }
  },
  { immediate: true }
)

onBeforeUnmount(() => {
  resetScopedMatchupState()
})

async function fetchIntel(seq: number, force = false) {
  const targetId = resolvedTargetId.value
  const lane = effectiveLane.value
  const query = {
    region: String(region.value),
    tier: String(tier.value),
    version: opggVersion.value
  }
  if (!targetId || !lane || opggMode.value !== 'ranked' || !effectiveSource.value) {
    intel.value = null
    return
  }
  isLoading.value = true
  errorText.value = ''
  try {
    await ensurePriors()
    if (seq !== requestSeq) return
    const result = await ipc.call<CounterIntelResult>(
      CHAMPION_DATA_MAIN_NAMESPACE,
      'counterIntel/get',
      {
        championId: targetId,
        position: lane,
        region: query.region,
        tier: query.tier,
        version: query.version,
        force
      }
    )
    const resultMatchesRequest =
      result.championId === targetId &&
      result.position === lane &&
      result.region === query.region &&
      String(result.tier) === query.tier &&
      result.version === query.version
    if (seq === requestSeq && resultMatchesRequest) {
      intel.value = result
    } else if (seq === requestSeq) {
      intel.value = null
      errorText.value = '获取失败：OP.GG 克制表响应口径不匹配'
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

function refresh(immediate = false, force = false) {
  const seq = ++requestSeq
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  // 依赖变化后立即撤下旧表，不能在防抖/网络期间继续展示上一个补丁的数据。
  intel.value = null
  errorText.value = ''
  isLoading.value = false
  if (immediate) {
    void fetchIntel(seq, force)
  } else {
    debounceTimer = setTimeout(() => void fetchIntel(seq), 400)
  }
}

function refreshAll() {
  void ensurePriors(true)
  refresh(true, true)
  scheduleMatchupOverlay(true)
}

watch(
  [
    observedMatchupSessionKey,
    resolvedTargetId,
    effectiveLane,
    () => region.value,
    () => tier.value,
    () => opggVersion.value,
    () => opggMode.value,
    () => effectiveSource.value
  ],
  () => refresh()
)
watch(
  [() => region.value, () => tier.value, () => opggVersion.value],
  () => {
    priorsSeq++
    priors.value = null
    priorsKey = ''
    priorsRetryKey = ''
    priorsRetryAt = 0
    if (observedMatchupSession.value) void ensurePriors()
  },
  { flush: 'sync' }
)
watch(session, (s) => {
  if (s) {
    void ensurePriors()
  } else {
    requestSeq++
    intel.value = null
    errorText.value = ''
  }
})
if (observedMatchupSession.value) {
  void ensurePriors()
  refresh()
}

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
