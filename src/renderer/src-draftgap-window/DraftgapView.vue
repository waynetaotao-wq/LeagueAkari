<template>
  <div class="dgx-root">
    <!-- 顶栏（原版风：logo · 徽章 · 同步按钮 · 窗口钮），整条可拖拽 -->
    <header class="dgx-header">
      <span class="dgx-logo">团队之选</span>
      <span class="dgx-logo-sub">DRAFTGAP 引擎 · MIT</span>
      <span class="dgx-grad" />
      <span class="dgx-badge">钻石+ · 近30天 · 全球</span>
      <span v-if="resp" class="dgx-updated">上次计算 {{ resp.tookMs }}ms · 拉取{{ resp.requested }}<template v-if="resp.failed">/失败{{ resp.failed }}</template></span>
      <button class="dgx-sync" :disabled="loading || !inChampSelect" @click="refresh()">
        {{ loading ? '计算中…' : '重新计算' }}
      </button>
      <button class="dgx-win" title="最小化" @click="winop('minimize')">─</button>
      <button class="dgx-win" title="隐藏（进选人自动出现）" @click="winop('hide')">✕</button>
    </header>

    <!-- 待机 -->
    <div v-if="!inChampSelect" class="dgx-idle">
      <div class="dgx-idle-logo">团队之选</div>
      <div class="dgx-idle-sub">进入英雄选择后，这里会自动亮起：两侧为双方盘面与胜率，中间是为你算好的候选榜</div>
    </div>

    <!-- 三栏主体 -->
    <div v-else class="dgx-body">
      <TeamColumn title="我方" :winrate="allyWinrate" :cards="allyCards" />

      <main class="dgx-center">
        <div class="dgx-tools">
          <div class="dgx-search">
            <span class="dgx-search-ico">⌕</span>
            <input v-model="filterText" placeholder="搜索候选…" />
          </div>
          <template v-if="autoRole === null">
            <select v-model="manualRole" class="dgx-select">
              <option :value="-1">选择我的分路…</option>
              <option v-for="(n, i) in roleNames" :key="i" :value="i">{{ n }}</option>
            </select>
          </template>
          <span v-else class="dgx-role">{{ roleNames[autoRole] }}</span>
          <label class="dgx-seg" :class="{ on: sortMastery }">
            <input type="checkbox" v-model="sortMastery" />熟练加权
          </label>
        </div>

        <div v-if="enemyInferList.length" class="dgx-infer">
          <span class="dgx-infer-label">敌方位置推断</span>
          <span v-for="r2 in enemyInferList" :key="r2.id" class="dgx-infer-item" :class="{ low: r2.p < 0.6 }">
            {{ metaName(r2.id) }}→{{ r2.lane }} {{ Math.round(r2.p * 100) }}%
          </span>
        </div>
        <div v-if="inChampSelect && enemyIds.length && !priorsReady" class="dgx-warnbar">⚠ 分路出场先验暂不可用，敌方位置推断可信度降低（自动重试中）</div>
        <div v-if="masteryUnavailable" class="dgx-warnbar">⚠ 熟练度数据暂不可用（客户端可能刚启动），候选池退化为可选英雄前 45 名；进入下一局或点重新计算会自动重试</div>
        <div v-for="(w, i) in teamCheckWarnings" :key="'tc' + i" class="dgx-warnbar">⚠ {{ w }}</div>
        <div v-if="hoverNotice" class="dgx-notice">{{ hoverNotice }}</div>
        <div v-if="error" class="dgx-error">{{ error }}</div>

        <div class="dgx-table">
          <div class="dgx-thead">
            <span class="c-rank">#</span>
            <span class="c-role">分路</span>
            <span class="c-champ">英雄</span>
            <span class="c-mastery">熟练</span>
            <span class="c-wr">胜率</span>
            <span class="c-info"></span>
            <span class="c-pick"></span>
          </div>
          <div class="dgx-tbody">
            <div v-if="loading && !sorted.length" class="dgx-hint">首次计算需拉取数据，约 5~20 秒…</div>
            <div v-else-if="!filtered.length" class="dgx-hint">{{ sorted.length ? '没有匹配的候选' : '暂无候选（等待分路/可选英雄信息，或点重新计算）' }}</div>
            <div v-for="(s, idx) in filtered" :key="s.championId" class="dgx-row">
              <span class="c-rank">{{ idx + 1 }}</span>
              <span class="c-role"><img v-if="roleIcon" :src="roleIcon" class="role-ico" /></span>
              <span class="c-champ">
                <img v-if="s.icon" class="champ-ico" :src="s.icon" loading="lazy" />
                <span class="champ-name">{{ s.name }}</span>
                <span class="champ-stars">{{ '★'.repeat(s.confidence.stars) }}</span>
              </span>
              <span class="c-mastery">
                <template v-if="s.masteryPoints > 0">{{ kfmt(s.masteryPoints) }}<em v-if="sortMastery && s.masteryRating > 0"> +{{ s.masteryRating.toFixed(1) }}</em></template>
                <template v-else>—</template>
              </span>
              <span class="c-wr" :class="s.winrate >= 0.5 ? 'up' : 'down'">{{ (s.winrate * 100).toFixed(2) }}</span>
              <span class="c-info" :title="partsTitle(s)">ⓘ</span>
              <span class="c-pick">
                <button class="pick-btn" :disabled="!canHover(s.championId)" @click="hoverChampion(s.championId)">选</button>
              </span>
            </div>
          </div>
        </div>

        <details v-if="resp && resp.warnings.length" class="dgx-details">
          <summary>数据告警 {{ resp.warnings.length }} 条</summary>
          <div v-for="(w, i) in resp.warnings" :key="i" class="dgx-warnline">{{ w }}</div>
        </details>
      </main>

      <TeamColumn title="敌方" :winrate="enemyWinrate" :cards="enemyCards" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useInstance } from '@renderer-shared/shards'
import { CHAMPION_DATA_MAIN_NAMESPACE } from '@renderer-shared/shards/champion-data/context'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import type { RolePriors } from '@shared/types/counter-intel'
import {
  assignLanes,
  LANE_ORDER,
  type LaneAssignmentInput
} from '@shared/utils/lane-assignment'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import TeamColumn, { type TeamCard } from './TeamColumn.vue'

const NS = 'window-manager-main/draftgap-window'

interface SuggestionDto {
  championId: number
  name: string
  icon: string
  winrate: number
  totalRating: number
  sortRating: number
  masteryRating: number
  masteryPoints: number
  parts: { base: number; allyDuo: number; matchup: number; context: number }
  confidence: { stars: 1 | 2 | 3; baseGames: number; pairGamesAvg: number | null }
}
interface DraftgapResponse {
  ok: boolean
  boardWinrate: number
  suggestions: SuggestionDto[]
  teamCheck: { physicalPct: number | null; magicPct: number | null; warnings: string[] }
  warnings: string[]
  requested: number
  failed: number
  tier: string
  patch: string
  tookMs: number
  error?: string
}
interface ChampMeta {
  id: number
  name: string
  icon: string
  splash: string
}

const ipc = useInstance(AkariIpcRenderer)
const lc = useInstance(LeagueClientRenderer)
const lcs = useLeagueClientStore()
const resources = useAkariResourceProvider()

const roleNames = ['上单', '打野', '中单', '下路', '辅助'] as const
const POS_TO_ROLE: Record<string, number> = {
  top: 0,
  jungle: 1,
  middle: 2,
  mid: 2,
  bottom: 3,
  adc: 3,
  utility: 4,
  support: 4
}
const ROLE_ICONS = [
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-top.png',
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-jungle.png',
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-middle.png',
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-bottom.png',
  'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-utility.png'
]

function winop(action: 'minimize' | 'hide') {
  ipc.call(NS, 'winop', { action }).catch(() => {})
}

const session = computed(() => lcs.champSelect.session)
const inChampSelect = computed(
  () => lcs.gameflow.phase === 'ChampSelect' && !session.value?.isSpectating
)
const pickableIds = computed(() => lcs.champSelect.currentPickableChampionIds)

const autoRole = computed<number | null>(() => {
  const s = session.value
  if (!s) return null
  const me = s.myTeam.find((t) => t.cellId === s.localPlayerCellId)
  const r = POS_TO_ROLE[me?.assignedPosition ?? '']
  return r === undefined ? null : r
})
const manualRole = ref(-1)
const myRole = computed<number | null>(() =>
  autoRole.value !== null ? autoRole.value : manualRole.value >= 0 ? manualRole.value : null
)
const roleIcon = computed(() => (myRole.value === null ? '' : ROLE_ICONS[myRole.value]))

function slotsOf(team: any[], excludeCell: number | null) {
  const out: { role: number; championId: number }[] = []
  for (const t of team ?? []) {
    if (excludeCell !== null && t.cellId === excludeCell) continue
    const cid = t.championId || 0
    const role = POS_TO_ROLE[t.assignedPosition ?? '']
    if (cid > 0 && role !== undefined) out.push({ role, championId: cid })
  }
  return out
}
function currentAllies() {
  const s = session.value
  if (!s) return []
  return slotsOf(s.myTeam, s.localPlayerCellId)
}
const allies = computed(() => currentAllies())

// —— 敌方：分路出场率 → 全排列最大似然指派（对位克制助手同款算法） ——
const rolePriors = ref<RolePriors>({})
const priorsReady = ref(false)
async function pullPriors() {
  try {
    rolePriors.value =
      (await ipc.call<RolePriors>(
        CHAMPION_DATA_MAIN_NAMESPACE,
        'counterIntel/rolePriors',
        'global',
        'all'
      )) ?? {}
    priorsReady.value = Object.keys(rolePriors.value).length > 0
  } catch {
    priorsReady.value = false
  }
}

function currentEnemyIds(): number[] {
  const s = session.value
  if (!s) return []
  const ids = (s.theirTeam ?? [])
    .map((t: any) => t.championId || 0)
    .filter((c: number) => c > 0)
  return [...new Set(ids)] as number[]
}
const enemyIds = computed(() => currentEnemyIds())

function currentAssignment() {
  const ids = currentEnemyIds()
  if (!ids.length) return null
  const inputs: LaneAssignmentInput[] = ids.map((id) => ({
    championId: id,
    roleRates: rolePriors.value[id] ?? {}
  }))
  return assignLanes(inputs)
}
const enemyAssignment = computed(() => currentAssignment())

function currentEnemies(): { role: number; championId: number }[] {
  const a = currentAssignment()
  if (!a) return []
  const out: { role: number; championId: number }[] = []
  LANE_ORDER.forEach((lane, i) => {
    const cid = a.byLane[lane]
    if (cid !== undefined) out.push({ role: i, championId: cid })
  })
  return out
}

const LANE_CN = ['上', '野', '中', '下', '辅'] as const
const enemyInferList = computed(() => {
  const a = enemyAssignment.value
  if (!a) return []
  const rows: { id: number; lane: string; p: number }[] = []
  LANE_ORDER.forEach((lane, i) => {
    const cid = a.byLane[lane]
    if (cid !== undefined) rows.push({ id: cid, lane: LANE_CN[i], p: a.posterior[cid]?.[lane] ?? 0 })
  })
  return rows
})

// —— 英雄元信息（横幅原画/名字），批量拉取带缓存 ——
const metaMap = ref<Record<number, ChampMeta>>({})
async function ensureMeta(ids: number[]) {
  const missing = [...new Set(ids)].filter((i) => i > 0 && !metaMap.value[i])
  if (!missing.length) return
  try {
    const arr = await ipc.call<ChampMeta[]>(NS, 'championMeta', missing)
    const next = { ...metaMap.value }
    for (const m of arr ?? []) next[m.id] = m
    metaMap.value = next
  } catch {}
}
function metaName(id: number): string {
  return metaMap.value[id]?.name ?? resources.champions.name(id) ?? `#${id}`
}

// —— 盘面栏卡片 ——
const myLockedPick = computed<number>(() => {
  const s = session.value
  if (!s) return 0
  const me = s.myTeam.find((t) => t.cellId === s.localPlayerCellId)
  return me?.championId || 0
})
const allyCards = computed<TeamCard[]>(() => {
  const s = session.value
  const byRole: Record<number, { cid: number; me: boolean }> = {}
  for (const t of s?.myTeam ?? []) {
    const r = POS_TO_ROLE[t.assignedPosition ?? '']
    if (r !== undefined) byRole[r] = { cid: t.championId || 0, me: t.cellId === s!.localPlayerCellId }
  }
  const out: TeamCard[] = []
  for (let r = 0; r < 5; r++) {
    const e = byRole[r]
    const cid = e?.cid ?? 0
    out.push({
      role: r,
      championId: cid,
      name: cid ? metaName(cid) : undefined,
      splash: cid ? metaMap.value[cid]?.splash : undefined,
      sub: e?.me ? '你' : undefined,
      me: !!e?.me
    })
  }
  return out
})
const enemyCards = computed<TeamCard[]>(() => {
  const a = enemyAssignment.value
  const out: TeamCard[] = []
  for (let r = 0; r < 5; r++) {
    const lane = LANE_ORDER[r]
    const cid = a?.byLane[lane] ?? 0
    const p = cid ? (a!.posterior[cid]?.[lane] ?? 0) : 0
    out.push({
      role: r,
      championId: cid,
      name: cid ? metaName(cid) : undefined,
      splash: cid ? metaMap.value[cid]?.splash : undefined,
      sub: cid ? `推断 ${Math.round(p * 100)}%` : undefined,
      low: cid ? p < 0.6 : false
    })
  }
  return out
})
watch(
  () => [...allies.value.map((a) => a.championId), myLockedPick.value, ...enemyIds.value].join(','),
  () => ensureMeta([...allies.value.map((a) => a.championId), myLockedPick.value, ...enemyIds.value]),
  { immediate: true }
)

// —— 候选池：熟练度 Top45 ∩ 本局可选 ——
const masteries = ref<Record<number, number>>({})
async function pullMasteries() {
  try {
    masteries.value = (await ipc.call<Record<number, number>>(NS, 'getMasteries')) ?? {}
  } catch {
    masteries.value = {}
  }
}
onMounted(() => {
  pullMasteries()
  pullPriors()
})
watch(inChampSelect, (v) => {
  if (v && Object.keys(masteries.value).length === 0) pullMasteries()
  if (v && !priorsReady.value) pullPriors()
})
const masteryUnavailable = computed(
  () => inChampSelect.value && Object.keys(masteries.value).length === 0
)

function currentCandidates(): number[] {
  const pickable = pickableIds.value
  if (!pickable || pickable.size === 0) return []
  const byMastery = Object.entries(masteries.value)
    .map(([id, pts]) => ({ id: Number(id), pts: pts as number }))
    .sort((a, b) => b.pts - a.pts)
    .map((x) => x.id)
    .filter((id) => pickable.has(id))
    .slice(0, 45)
  if (byMastery.length >= 5) return byMastery
  const extra: number[] = []
  for (const id of pickable) {
    if (!byMastery.includes(id)) extra.push(id)
    if (byMastery.length + extra.length >= 45) break
  }
  return [...byMastery, ...extra]
}
const candidateIds = computed<number[]>(() => currentCandidates())

// —— 请求主流程（现场取数） ——
const resp = ref<DraftgapResponse | null>(null)
const loading = ref(false)
const error = ref('')

async function refresh() {
  if (!inChampSelect.value) return
  const role = myRole.value
  const cands = currentCandidates()
  if (role === null || cands.length === 0) return
  loading.value = true
  error.value = ''
  try {
    const r = await ipc.call<DraftgapResponse>(NS, 'getRecommendations', {
      myRole: role,
      myPick: myLockedPick.value || undefined,
      allies: currentAllies(),
      enemies: currentEnemies(),
      candidateIds: cands
    })
    resp.value = r
    if (!r.ok) error.value = `计算失败：${r.error ?? '未知错误'}`
  } catch (e: any) {
    error.value = `请求失败：${e?.message ?? e}`
  } finally {
    loading.value = false
  }
}

function lockedFromActions(): string {
  const s = session.value
  if (!s) return ''
  const done: string[] = []
  for (const g of s.actions ?? []) {
    for (const a of g) {
      if (a.type === 'pick' && a.completed && a.championId > 0) {
        done.push(`${a.actorCellId}:${a.championId}`)
      }
    }
  }
  return done.sort().join(',')
}

const watchKey = computed(() =>
  JSON.stringify({
    p: inChampSelect.value,
    r: myRole.value,
    mp: myLockedPick.value,
    a: allies.value,
    e: enemyIds.value,
    l: lockedFromActions(),
    pr: priorsReady.value,
    c: candidateIds.value.length
  })
)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(watchKey, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => refresh(), 600)
})

// 终极兜底：3 秒轮询直读会话
function liveSnapshot(): string {
  const s: any = session.value
  if (!s) return ''
  const parts: string[] = []
  for (const t of s.myTeam ?? []) parts.push(`m${t.cellId}:${t.championId || 0}`)
  for (const t of s.theirTeam ?? []) parts.push(`t${t.cellId}:${t.championId || 0}`)
  return parts.join(',') + '#' + lockedFromActions()
}
let lastSnap = ''
let pollTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  pollTimer = setInterval(() => {
    if (!inChampSelect.value) {
      lastSnap = ''
      return
    }
    const snap = liveSnapshot()
    if (snap !== lastSnap) {
      lastSnap = snap
      if (!loading.value) refresh()
    }
  }, 3000)
})
onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

// —— 榜单展示 ——
const sortMastery = ref(true)
const filterText = ref('')
const sorted = computed(() => {
  const list = resp.value?.suggestions ?? []
  const key = sortMastery.value ? 'sortRating' : 'totalRating'
  return [...list].sort((a, b) => (b as any)[key] - (a as any)[key])
})
const filtered = computed(() => {
  const q = filterText.value.trim().toLowerCase()
  if (!q) return sorted.value
  return sorted.value.filter((s) => s.name.toLowerCase().includes(q))
})
const teamCheckWarnings = computed(() => resp.value?.teamCheck.warnings ?? [])

const allyWinrate = computed<number | null>(() => (resp.value ? resp.value.boardWinrate : null))
const enemyWinrate = computed<number | null>(() =>
  resp.value ? 1 - resp.value.boardWinrate : null
)

function partsTitle(s: SuggestionDto) {
  const f = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(1)
  const pg =
    s.confidence.pairGamesAvg === null ? '无' : Math.round(s.confidence.pairGamesAvg) + '场'
  return (
    `拆解(rating)：本体强度 ${f(s.parts.base)} ｜ 我方协同 ${f(s.parts.allyDuo)} ｜ 对位 ${f(
      s.parts.matchup
    )} ｜ 阵容背景 ${f(s.parts.context)}\n` +
    `样本：本体 ${s.confidence.baseGames} 场 · 配对均值 ${pg}\n` +
    `熟练度：${s.masteryPoints} 点（加权 ${f(s.masteryRating)}，仅影响排序，可关）`
  )
}
function kfmt(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1000) return Math.round(n / 1000) + 'k'
  return String(n)
}

// ===== 一键选用（不锁定）=====
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
  const nm = metaName(championId)
  try {
    await lc.api.champSelect.action(actionId, { championId, completed: false })
    hoverNotice.value = `已选择 ${nm}（未锁定，请自行确认）`
  } catch (e: any) {
    hoverNotice.value = `选择失败：${e?.response?.data?.message ?? e?.message ?? e}`
  }
  if (hoverNoticeTimer) clearTimeout(hoverNoticeTimer)
  hoverNoticeTimer = setTimeout(() => (hoverNotice.value = ''), 2500)
}
</script>

<style scoped>
.dgx-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #060608;
  color: #e5e7eb;
  font-family: Bahnschrift, 'Arial Narrow', 'Segoe UI', sans-serif;
  overflow: hidden;
}
/* ===== 顶栏 ===== */
.dgx-header {
  -webkit-app-region: drag;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px 6px;
  flex-shrink: 0;
  position: relative;
}
.dgx-logo {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 3px;
  color: #fff;
}
.dgx-logo-sub {
  font-size: 10px;
  color: #6b7280;
  letter-spacing: 1px;
}
.dgx-grad {
  flex: 1;
}
.dgx-header::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 3px;
  background: linear-gradient(90deg, #ef4444 0%, #ef4444 45%, #3b82f6 55%, #3b82f6 100%);
}
.dgx-badge {
  font-size: 11px;
  color: #9ca3af;
  border: 1px solid #26262e;
  border-radius: 10px;
  padding: 2px 10px;
}
.dgx-updated {
  font-size: 10px;
  color: #6b7280;
}
.dgx-sync {
  -webkit-app-region: no-drag;
  border: 1px solid #3a3a44;
  background: #17171c;
  color: #fff;
  font-weight: 700;
  letter-spacing: 1px;
  font-size: 12px;
  padding: 5px 16px;
  border-radius: 16px;
  cursor: pointer;
}
.dgx-sync:hover:not(:disabled) {
  background: #23232b;
}
.dgx-sync:disabled {
  opacity: 0.45;
  cursor: default;
}
.dgx-win {
  -webkit-app-region: no-drag;
  width: 28px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: rgba(128, 128, 128, 0.14);
  color: #d1d5db;
  cursor: pointer;
  font-size: 12px;
}
.dgx-win:hover {
  background: rgba(128, 128, 128, 0.32);
}
/* ===== 待机 ===== */
.dgx-idle {
  margin: auto;
  text-align: center;
  color: #6b7280;
  padding: 0 40px;
}
.dgx-idle-logo {
  font-size: 42px;
  font-weight: 800;
  letter-spacing: 8px;
  color: #26262e;
  margin-bottom: 14px;
}
/* ===== 三栏 ===== */
.dgx-body {
  flex: 1;
  display: grid;
  grid-template-columns: minmax(220px, 300px) 1fr minmax(220px, 300px);
  gap: 8px;
  padding: 8px;
  min-height: 0;
}
.dgx-center {
  display: flex;
  flex-direction: column;
  background: #0d0d11;
  border-radius: 8px;
  padding: 10px;
  min-width: 0;
  min-height: 0;
}
/* ===== 工具条 ===== */
.dgx-tools {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.dgx-search {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  background: #17171c;
  border: 1px solid #26262e;
  border-radius: 8px;
  padding: 5px 10px;
}
.dgx-search-ico {
  color: #6b7280;
}
.dgx-search input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: #fff;
  font-size: 13px;
}
.dgx-select {
  background: #17171c;
  color: #fff;
  border: 1px solid #26262e;
  border-radius: 8px;
  font-size: 12px;
  padding: 4px 8px;
}
.dgx-role {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 1px;
  padding: 3px 12px;
  border-radius: 10px;
  background: rgba(245, 166, 35, 0.15);
  color: #f5a623;
}
.dgx-seg {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 700;
  padding: 4px 12px;
  border-radius: 8px;
  border: 1px solid #26262e;
  background: #17171c;
  color: #9ca3af;
  cursor: pointer;
  user-select: none;
}
.dgx-seg.on {
  color: #fff;
  background: #26262e;
}
/* ===== 提示条 ===== */
.dgx-infer {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  align-items: center;
  font-size: 11px;
  margin-bottom: 6px;
  color: #d1d5db;
}
.dgx-infer-label {
  color: #6b7280;
}
.dgx-infer-item {
  padding: 1px 8px;
  border-radius: 8px;
  background: #1b1b22;
}
.dgx-infer-item.low {
  background: rgba(240, 160, 32, 0.2);
  color: #f5a623;
}
.dgx-warnbar {
  background: rgba(240, 160, 32, 0.12);
  border: 1px solid rgba(240, 160, 32, 0.35);
  border-radius: 6px;
  padding: 4px 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
.dgx-notice {
  background: rgba(99, 226, 183, 0.12);
  border-radius: 6px;
  padding: 3px 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
.dgx-error {
  background: rgba(232, 128, 128, 0.14);
  border-radius: 6px;
  padding: 3px 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
/* ===== 表格 ===== */
.dgx-table {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  border: 1px solid #1c1c23;
  border-radius: 8px;
  overflow: hidden;
}
.dgx-thead,
.dgx-row {
  display: grid;
  grid-template-columns: 34px 44px 1fr 90px 78px 34px 52px;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
}
.dgx-thead {
  height: 34px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 2px;
  color: #6b7280;
  text-transform: uppercase;
  background: #101015;
  border-bottom: 1px solid #1c1c23;
}
.dgx-tbody {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}
.dgx-hint {
  padding: 26px;
  text-align: center;
  color: #6b7280;
}
.dgx-row {
  height: 44px;
  border-bottom: 1px solid #14141a;
}
.dgx-row:hover {
  background: #14141b;
}
.c-rank {
  color: #4b5563;
  font-size: 12px;
  text-align: right;
}
.role-ico {
  width: 20px;
  height: 20px;
  opacity: 0.8;
}
.c-champ {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.champ-ico {
  width: 28px;
  height: 28px;
  border-radius: 4px;
  flex-shrink: 0;
}
.champ-name {
  font-size: 15px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #fff;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.champ-stars {
  color: #f0c040;
  font-size: 10px;
  letter-spacing: 1px;
  flex-shrink: 0;
}
.c-mastery {
  font-size: 11px;
  color: #9ca3af;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.c-mastery em {
  font-style: normal;
  color: #63e2b7;
}
.c-wr {
  font-size: 17px;
  font-weight: 700;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.c-wr.up {
  color: #f5a623;
}
.c-wr.down {
  color: #ef4444;
}
.c-info {
  color: #4b5563;
  text-align: center;
  cursor: help;
  font-size: 14px;
}
.c-info:hover {
  color: #9ca3af;
}
.pick-btn {
  width: 100%;
  padding: 4px 0;
  border: none;
  border-radius: 6px;
  background: rgba(245, 166, 35, 0.22);
  color: #f5a623;
  font-weight: 700;
  cursor: pointer;
  font-size: 12px;
}
.pick-btn:hover:not(:disabled) {
  background: rgba(245, 166, 35, 0.38);
}
.pick-btn:disabled {
  opacity: 0.3;
  cursor: default;
}
.dgx-details {
  margin-top: 6px;
  font-size: 11px;
  color: #9ca3af;
}
.dgx-warnline {
  padding: 1px 0 1px 12px;
  opacity: 0.8;
}
</style>
