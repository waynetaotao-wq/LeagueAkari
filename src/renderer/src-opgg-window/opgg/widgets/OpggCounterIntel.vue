<template>
  <div
    v-if="session || inGameMatchup"
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
        <span class="text-[#666666] dark:text-[#b2b2b2]">已替换</span>
        <span
          v-for="k of matchupSections"
          :key="k"
          class="rounded bg-[#2a947d]/12 px-1 text-[#2a947d] dark:bg-[#5fd3a5]/12 dark:text-[#5fd3a5]"
        >
          {{ SECTION_LABELS[k] ?? k }}
        </span>
        <template v-if="missingSections.length">
          <span class="ml-1 text-[#666666] dark:text-[#b2b2b2]">未替换</span>
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
      <div
        v-if="bzRow"
        class="mt-2 rounded border border-black/10 p-2 dark:border-[#37373c]"
      >
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
          <template v-if="bzRow.coreItemIds && bzRow.coreItemIds.length">
            核心装已按 Bz 推荐**置顶**至下方"核心装备"区（首行、无胜率数据）；
          </template>
          <template v-if="bzExtras">
            召唤师技能与出门装同样已置顶至各自区块首行；
          </template>
          <template v-if="bzRow.keystonePerkId">
            符文区已按 Bz 基石**筛选流派**（保留 OP.GG 完整页数据）；
          </template>
          数据来自 Bz 的对线表（云端实时同步，其更新最迟 10 分钟内生效）；未收录的对线自动回落 OP.GG
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
              <span class="min-w-0 flex-1 truncate text-xs">{{ championName(row.championId) }}</span>
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
                class="w-9 text-right text-[10px] tabular-nums text-[#666666] dark:text-[#b2b2b2]"
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
              <span class="min-w-0 flex-1 truncate text-xs">{{ championName(row.championId) }}</span>
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
                class="w-9 text-right text-[10px] tabular-nums text-[#666666] dark:text-[#b2b2b2]"
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
  CounterIntelResult,
  MatchupBuildResult,
  RolePriors
} from '@shared/types/counter-intel'
import { type LaneName, resolveLaneOpponent } from '@shared/utils/lane-assignment'
import { RefreshSharp } from '@vicons/ionicons5'
import { NButton, NIcon, NScrollbar, NSelect, NSpin, NSwitch } from 'naive-ui'
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { useOpgg } from '../context'
import { useMatchupOverlay } from '../matchup-overlay'

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
  version: opggVersion,
  versions: opggVersions,
  effectiveSource
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

// ===== [lolps] 对位数据整窗替换 =====
// 识别到对位后拉取官方形状 overlay 写入共享状态；OpggView 就近 provide 覆盖 champion，
// 原界面所有区块（符文/召唤师/出装）与"应用"按钮自动切换为对位版数据，UI 零改动。
const { setMatchupOverlay } = useMatchupOverlay()
// [lolps] 默认折叠为一行摘要，不遮挡下方符文/出装区块
const expanded = ref(false)

const matchupOn = ref(true)
const matchupStatus = ref('')

/** 区块键 → 中文标签（诊断行用） */
const SECTION_LABELS: Record<string, string> = {
  runes: '符文',
  summoner_spells: '召唤师',
  starter_items: '出门装',
  boots: '鞋',
  core_items: '核心装',
  last_items: '装备'
}
const ALL_SECTIONS = ['runes', 'summoner_spells', 'starter_items', 'boots', 'core_items']
/** 本次对位实际替换成功的区块（含 Bz 并入项） */
const matchupSections = ref<string[]>([])
const missingSections = computed(() =>
  matchupSections.value.length ? ALL_SECTIONS.filter((k) => !matchupSections.value.includes(k)) : []
)
let matchupSeq = 0
let matchupTimer: ReturnType<typeof setTimeout> | null = null

/** [lolps] 对位锁定态：选人期挂上对位构筑后，整个对局周期内保持不还原 */
const matchupLock = ref<{
  myChampionId: number
  opponentChampionId: number
  lane: string
  validated: boolean
} | null>(null)

/** [lolps] Bz（欧服第一劫）攻略：我方为劫且对位命中其表时展示（自动跟随其表更新） */
const ZED_ID = 238
const bzRow = ref<{
  champion: string
  rune: string
  difficulty: string
  coreBuild: string
  summary: string
  coreItemIds?: number[]
  keystonePerkId?: number | null
} | null>(null)
const bzExtras = computed(() => (bzRow.value ? getBzExtras(bzRow.value.champion) : null))

/** 流水线内查询：仅劫生效；失败返回 null（不影响 OP.GG 主链路） */
async function fetchBzRow(me: number, opp: number): Promise<any | null> {
  if (me !== ZED_ID || !opp) return null
  try {
    const res = await ipc.call<{ found: boolean; row: any }>(
      CHAMPION_DATA_MAIN_NAMESPACE,
      'counterIntel/bzGuide',
      { opponentChampionId: opp }
    )
    return res?.found ? res.row : null
  } catch {
    return null
  }
}

/** Bz 命中时：把其核心装序列置顶进 overlay（最高优先级；符文因表内无完整页不覆盖） */
function mergeBzIntoOverlay(overlay: Record<string, unknown> | null, bz: any): Record<string, unknown> | null {
  const hasCore = bz?.coreItemIds && bz.coreItemIds.length >= 2
  const keystone = typeof bz?.keystonePerkId === 'number' ? bz.keystonePerkId : null
  // 召唤师技能与出门装（人工识别写死）同样置顶进原生区块，与核心装同一语义
  const extras = bz?.champion ? getBzExtras(bz.champion) : null
  if (!hasCore && keystone === null && !extras) return overlay
  const base: Record<string, unknown> = overlay ? { ...overlay } : {}
  const topOf = (key: string, ids: number[]) => {
    const existing = Array.isArray(base[key]) ? (base[key] as any[]) : []
    base[key] = [{ ids, play: 0, win: 0, pick_rate: 0 }, ...existing]
  }
  if (hasCore) {
    topOf('core_items', bz.coreItemIds)
  }
  if (extras) {
    topOf('summoner_spells', [...extras.spellIds])
    topOf('starter_items', [extras.starterItemId])
  }
  // Bz 基石筛选：OP.GG 对位符文页里仅保留基石一致的流派；全灭则保留原样（防空白）
  if (keystone !== null && Array.isArray(base.runes)) {
    const filtered = (base.runes as any[]).filter(
      (pg) => pg?.primary_rune_ids?.[0] === keystone
    )
    if (filtered.length > 0 && filtered.length < (base.runes as any[]).length) {
      base.runes = filtered
    }
  }
  return base
}

/** 视为"对局进行中"的阶段（含加载与断线重连），期间任何依赖抖动都不触碰 overlay */
const IN_GAME_PHASES = new Set(['GameStart', 'InProgress', 'Reconnect'])
/** 对局周期结束（含结算与回到大厅/秒退）——此时才还原通用构筑 */
const GAME_OVER_PHASES = new Set(['WaitingForStats', 'PreEndOfGame', 'EndOfGame', 'None'])

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
const inGameMatchup = computed<{ me: number; opp: number; lane: LaneName } | null>(() => {
  const gd = (lcs.gameflow.session as any)?.gameData
  const myPuuid = lcs.summoner.me?.puuid
  if (!gd || !myPuuid) return null
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
  const lane = LCU_TO_LANE[String(meEntry?.selectedPosition ?? '').toUpperCase()]
  if (!me || !lane) return null
  const oppEntry = enemy.find(
    (x) => String(x?.selectedPosition ?? '').toUpperCase() === LANE_TO_LCU[lane]
  )
  const opp = Number(oppEntry?.championId ?? 0)
  if (!opp || opp === me) return null
  return { me, opp, lane }
})

const summaryText = computed(() => {
  if (bzRow.value) {
    return `Bz 推荐已就绪 vs ${bzRow.value.champion}${matchupStatus.value ? ` · ${matchupStatus.value}` : ''}`
  }
  if (matchupStatus.value) return matchupStatus.value
  if (resolvedTargetId.value && statusText.value) return statusText.value
  return '等待对位确认'
})

async function refreshMatchupOverlay() {
  // 对局进行中且已锁定：保持对位构筑原样（进游戏后 session 消失引发的依赖抖动一律忽略）
  if (matchupLock.value && IN_GAME_PHASES.has(String(lcs.gameflow.phase))) {
    return
  }
  const fromGame = inGameMatchup.value
  const me = myChampionId.value || fromGame?.me || 0
  const opp = resolvedTargetId.value || fromGame?.opp || 0
  const lane = effectiveLane.value || fromGame?.lane || ''
  // 守卫：仅排位模式有对位数据；OP.GG 源选了历史版本时网页只有最新版，暂停替换防口径漂移
  const latestVersion = opggVersions.value[0] ?? null
  const versionMismatch =
    effectiveSource.value === 'opgg' &&
    !!opggVersion.value &&
    !!latestVersion &&
    opggVersion.value !== latestVersion
  if (
    !matchupOn.value ||
    opggMode.value !== 'ranked' ||
    versionMismatch ||
    !me ||
    !opp ||
    !lane ||
    me === opp
  ) {
    matchupSeq++
    matchupLock.value = null
    bzRow.value = null
    matchupSections.value = []
    setMatchupOverlay(null)
    matchupStatus.value = !matchupOn.value
      ? '对位替换已关闭，显示通用构筑'
      : opggMode.value !== 'ranked'
        ? '当前模式无对位数据，显示通用构筑'
        : versionMismatch
          ? '已选历史版本，暂不做对位替换'
          : ''
    return
  }
  const seq = ++matchupSeq
  try {
    const result = await ipc.call<MatchupBuildResult>(
      CHAMPION_DATA_MAIN_NAMESPACE,
      'counterIntel/matchupBuild',
      {
        myChampionId: me,
        opponentChampionId: opp,
        position: lane,
        region: region.value,
        tier: tier.value
      }
    )
    if (seq !== matchupSeq) return
    if (result.overlay) {
      const metaText =
        result.meta && result.meta.play > 0
          ? `${result.meta.play} 场 · 胜率 ${((result.meta.win / result.meta.play) * 100).toFixed(1)}%`
          : ''
      const bz = await fetchBzRow(me, opp)
      if (seq !== matchupSeq) return
      bzRow.value = bz
      const merged = mergeBzIntoOverlay(result.overlay, bz)
      matchupSections.value = merged ? Object.keys(merged) : (result.parsedSections ?? [])
      setMatchupOverlay(merged, metaText)
      matchupLock.value = {
        myChampionId: me,
        opponentChampionId: opp,
        lane,
        validated: !!fromGame && !myChampionId.value
      }
      matchupStatus.value = bz
        ? `Bz 推荐已置顶（召唤师/出门装/核心装） · 对位构筑 vs ${championName(opp)}（OP.GG${metaText ? ` · ${metaText}` : ''}）`
        : `已切换对位构筑 vs ${championName(opp)}（OP.GG${metaText ? ` · ${metaText}` : ''}）`
    } else {
      const bz = await fetchBzRow(me, opp)
      if (seq !== matchupSeq) return
      bzRow.value = bz
      const bzOverlay = mergeBzIntoOverlay(null, bz)
      if (bzOverlay) {
        matchupSections.value = Object.keys(bzOverlay)
        setMatchupOverlay(bzOverlay)
        matchupLock.value = { myChampionId: me, opponentChampionId: opp, lane, validated: false }
        matchupStatus.value = `Bz 推荐已置顶 vs ${championName(opp)}（OP.GG 该对位样本不足）`
      } else {
        matchupLock.value = null
        matchupSections.value = []
        setMatchupOverlay(null)
        matchupStatus.value = '该对位样本不足，显示通用构筑'
      }
    }
  } catch (error: any) {
    if (seq !== matchupSeq) return
    matchupLock.value = null
    setMatchupOverlay(null)
    matchupStatus.value = `对位数据获取失败：${error?.message ?? error}`
  }
}

function scheduleMatchupOverlay() {
  if (matchupTimer) clearTimeout(matchupTimer)
  matchupTimer = setTimeout(() => void refreshMatchupOverlay(), 500)
}

watch(
  [
    () => myChampionId.value,
    resolvedTargetId,
    effectiveLane,
    () => region.value,
    () => tier.value,
    () => opggMode.value,
    () => opggVersion.value,
    matchupOn,
    inGameMatchup
  ],
  () => scheduleMatchupOverlay()
)

/** 进入加载/对局后：用真实双方阵容校验选人期的对位推测，必要时精确重定或诚实回退 */
async function validateMatchupAgainstRealTeams() {
  const lock = matchupLock.value
  if (!lock || lock.validated) return
  const gd = (lcs.gameflow.session as any)?.gameData
  const one: any[] = gd?.teamOne ?? []
  const two: any[] = gd?.teamTwo ?? []
  if (!one.length && !two.length) return // 阵容尚未就绪，等下一次相位变化再试
  const inTeam = (t: any[]) => t.some((x) => x?.championId === lock.myChampionId)
  const enemyTeam = inTeam(one) ? two : inTeam(two) ? one : null
  if (!enemyTeam || !enemyTeam.length) return
  const enemyIds = enemyTeam
    .map((x: any) => x?.championId)
    .filter((x: any) => typeof x === 'number' && x > 0)
  if (!enemyIds.length) return
  lock.validated = true

  // 位置优先：加载数据带真实位置时，以"敌方谁站我这条分路"为唯一标准——
  // 防止"推测英雄虽在敌方阵容、实际却在别的位置"（如推测的中单其实去了辅助）的误判
  const laneLcu = LANE_TO_LCU[lock.lane] ?? ''
  const posOf = (x: any) => String(x?.selectedPosition ?? x?.position ?? '').toUpperCase()
  const byPos = enemyTeam.filter((x: any) => laneLcu && posOf(x) === laneLcu)
  const posKnown =
    byPos.length === 1 && typeof byPos[0].championId === 'number' && byPos[0].championId > 0

  if (posKnown && byPos[0].championId === lock.opponentChampionId) {
    matchupStatus.value = `已确认真实对位 vs ${championName(lock.opponentChampionId)}，对位构筑锁定至对局结束`
    return
  }
  // 位置信息不可用时退化为阵容包含口径（可得信息下的最优判定）
  if (!posKnown && enemyIds.includes(lock.opponentChampionId)) {
    matchupStatus.value = `已确认真实对位 vs ${championName(lock.opponentChampionId)}，对位构筑锁定至对局结束`
    return
  }

  if (posKnown) {
    const newOpp = byPos[0].championId
    const seq = ++matchupSeq
    try {
      const result = await ipc.call<MatchupBuildResult>(
        CHAMPION_DATA_MAIN_NAMESPACE,
        'counterIntel/matchupBuild',
        {
          myChampionId: lock.myChampionId,
          opponentChampionId: newOpp,
          position: lock.lane,
          region: region.value,
          tier: tier.value
        }
      )
      if (seq !== matchupSeq) return
      if (result.overlay) {
        const metaText =
          result.meta && result.meta.play > 0
            ? `${result.meta.play} 场 · 胜率 ${((result.meta.win / result.meta.play) * 100).toFixed(1)}%`
            : ''
        const bz = await fetchBzRow(lock.myChampionId, newOpp)
        if (seq !== matchupSeq) return
        bzRow.value = bz
        const merged2 = mergeBzIntoOverlay(result.overlay, bz)
        matchupSections.value = merged2 ? Object.keys(merged2) : (result.parsedSections ?? [])
        setMatchupOverlay(merged2, metaText)
        lock.opponentChampionId = newOpp
        matchupStatus.value = `已按真实阵容修正对位 vs ${championName(newOpp)}（OP.GG${metaText ? ` · ${metaText}` : ''}）`
        return
      }
    } catch {}
  }

  // 无法确定真实对位：诚实回退通用构筑（Bz 相关一并撤除）
  matchupLock.value = null
  bzRow.value = null
  matchupSections.value = []
  matchupSeq++
  setMatchupOverlay(null)
  matchupStatus.value = '对面真实阵容与选人期推测不符，已回通用构筑'
}

/**
 * 校验轮询：相位刚跳进加载时客户端的真实阵容常未填充（英雄 id 暂为 0），
 * 一次性尝试会永远错过——改为每 3 秒重试，直到校验完成 / 锁失效 / 超时约 2 分钟。
 */
let validateTimer: ReturnType<typeof setInterval> | null = null

function stopValidateLoop() {
  if (validateTimer) {
    clearInterval(validateTimer)
    validateTimer = null
  }
}

function startValidateLoop() {
  stopValidateLoop()
  let tries = 0
  validateTimer = setInterval(() => {
    tries++
    const lock = matchupLock.value
    if (
      !lock ||
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

watch(
  () => lcs.gameflow.phase,
  (p) => {
    const phase = String(p)
    if (IN_GAME_PHASES.has(phase)) {
      startValidateLoop()
    } else if (GAME_OVER_PHASES.has(phase) && matchupLock.value) {
      stopValidateLoop()
      matchupLock.value = null
      bzRow.value = null
      matchupSections.value = []
      matchupSeq++
      setMatchupOverlay(null)
      matchupStatus.value = ''
    }
  }
)

onBeforeUnmount(() => {
  stopValidateLoop()
  matchupSeq++
  setMatchupOverlay(null)
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
