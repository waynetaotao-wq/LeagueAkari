<template>
  <div class="dg-root">
    <!-- 非选人阶段 -->
    <div v-if="!inChampSelect" class="dg-idle">
      <div class="dg-idle-title">待机中</div>
      <div class="dg-idle-sub">进入英雄选择后，这里会自动给出"为团队选人"的推荐榜</div>
    </div>

    <template v-else>
      <!-- 控制行 -->
      <div class="dg-controls">
        <label class="dg-check">
          <input type="checkbox" v-model="sortMastery" />
          熟练加权排序
        </label>
        <template v-if="autoRole === null">
          <select v-model="manualRole" class="dg-select">
            <option :value="-1">选择我的分路…</option>
            <option v-for="(n, i) in roleNames" :key="i" :value="i">{{ n }}</option>
          </select>
        </template>
        <span v-else class="dg-rolebadge">{{ roleNames[autoRole] }}</span>
        <button class="dg-refresh" :disabled="loading" @click="refresh()">
          {{ loading ? '计算中…' : '刷新' }}
        </button>
        <span v-if="resp" class="dg-stats">
          {{ resp.tookMs }}ms · 拉取{{ resp.requested }}<template v-if="resp.failed"
            >(失败{{ resp.failed }})</template
          >
        </span>
      </div>

      <!-- 阵容体检 -->
      <div v-if="teamCheckWarnings.length" class="dg-warnbar">
        <div v-for="(w, i) in teamCheckWarnings" :key="i">⚠ {{ w }}</div>
      </div>

      <div v-if="hoverNotice" class="dg-notice">{{ hoverNotice }}</div>
      <div v-if="error" class="dg-error">{{ error }}</div>

      <!-- 榜单 -->
      <div class="dg-list">
        <div v-if="loading && !sorted.length" class="dg-loading">首次计算需拉取数据，约 5~20 秒…</div>
        <div v-else-if="!sorted.length" class="dg-loading">
          暂无候选（等待分路/可选英雄信息，或点击刷新）
        </div>
        <div
          v-for="(s, idx) in sorted"
          :key="s.championId"
          class="dg-row"
          :title="partsTitle(s)"
        >
          <span class="dg-rank">{{ idx + 1 }}</span>
          <span class="dg-name">{{ s.name }}</span>
          <span class="dg-wr" :class="s.winrate >= 0.5 ? 'up' : 'down'">
            {{ (s.winrate * 100).toFixed(2) }}%
          </span>
          <span class="dg-stars">{{ '★'.repeat(s.confidence.stars) }}</span>
          <span class="dg-mastery" v-if="s.masteryPoints > 0"
            >{{ kfmt(s.masteryPoints)
            }}<em v-if="sortMastery && s.masteryRating > 0">
              +{{ s.masteryRating.toFixed(1) }}</em
            ></span
          >
          <span class="dg-mastery dim" v-else>—</span>
          <button
            class="dg-pick"
            :disabled="!canHover(s.championId)"
            @click="hoverChampion(s.championId)"
          >
            选
          </button>
        </div>
      </div>

      <!-- 数据告警 -->
      <details v-if="resp && resp.warnings.length" class="dg-details">
        <summary>数据告警 {{ resp.warnings.length }} 条</summary>
        <div v-for="(w, i) in resp.warnings" :key="i" class="dg-warnline">{{ w }}</div>
      </details>
      <div class="dg-footer">
        口径：{{ resp?.tier === 'diamond_plus' ? '钻石4以上' : resp?.tier || '钻石4以上' }} ·
        最近30天 · 全球 · 单双排 ｜ 引擎：DraftGap (MIT)
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { computed, onMounted, ref, watch } from 'vue'

const NS = 'window-manager-main/draftgap-window'

interface SuggestionDto {
  championId: number
  name: string
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

const ipc = useInstance(AkariIpcRenderer)
const lc = useInstance(LeagueClientRenderer)
const lcs = useLeagueClientStore()

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
const allies = computed(() => {
  const s = session.value
  if (!s) return []
  return slotsOf(s.myTeam, s.localPlayerCellId)
})
const enemies = computed(() => {
  const s = session.value
  if (!s) return []
  // 敌方缺少 assignedPosition 时，无位置信息的锁定英雄无法入表（引擎需按位建表）
  return slotsOf(s.theirTeam, null)
})

// —— 候选池：熟练度 Top45 ∩ 本局可选 ——
const masteries = ref<Record<number, number>>({})
onMounted(async () => {
  try {
    masteries.value = (await ipc.call<Record<number, number>>(NS, 'getMasteries')) ?? {}
  } catch {
    masteries.value = {}
  }
})
const candidateIds = computed<number[]>(() => {
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
    if (byMastery.length + extra.length >= 20) break
  }
  return [...byMastery, ...extra]
})

// —— 请求主流程 ——
const resp = ref<DraftgapResponse | null>(null)
const loading = ref(false)
const error = ref('')

async function refresh() {
  if (!inChampSelect.value) return
  const role = myRole.value
  if (role === null || candidateIds.value.length === 0) return
  loading.value = true
  error.value = ''
  try {
    const r = await ipc.call<DraftgapResponse>(NS, 'getRecommendations', {
      myRole: role,
      allies: allies.value,
      enemies: enemies.value,
      candidateIds: candidateIds.value
    })
    resp.value = r
    if (!r.ok) error.value = `计算失败：${r.error ?? '未知错误'}`
  } catch (e: any) {
    error.value = `请求失败：${e?.message ?? e}`
  } finally {
    loading.value = false
  }
}

const watchKey = computed(() =>
  JSON.stringify({
    p: inChampSelect.value,
    r: myRole.value,
    a: allies.value,
    e: enemies.value,
    c: candidateIds.value.length
  })
)
let debounceTimer: ReturnType<typeof setTimeout> | null = null
watch(watchKey, () => {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => refresh(), 600)
})

const sortMastery = ref(true)
const sorted = computed(() => {
  const list = resp.value?.suggestions ?? []
  const key = sortMastery.value ? 'sortRating' : 'totalRating'
  return [...list].sort((a, b) => (b as any)[key] - (a as any)[key])
})
const teamCheckWarnings = computed(() => resp.value?.teamCheck.warnings ?? [])

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

// ===== 一键选用（不锁定）——照抄自本项目已验证实现 =====
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
  const nm = sorted.value.find((s) => s.championId === championId)?.name ?? championId
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
.dg-root {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  font-size: 13px;
  overflow: hidden;
}
.dg-idle {
  margin: auto;
  text-align: center;
  opacity: 0.7;
}
.dg-idle-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 6px;
}
.dg-controls {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 6px;
}
.dg-check {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
}
.dg-select {
  font-size: 12px;
  padding: 2px 4px;
}
.dg-rolebadge {
  padding: 1px 8px;
  border-radius: 8px;
  background: rgba(99, 226, 183, 0.18);
  font-size: 12px;
}
.dg-refresh {
  padding: 2px 10px;
  border: none;
  border-radius: 4px;
  background: rgba(99, 226, 183, 0.25);
  cursor: pointer;
}
.dg-refresh:disabled {
  opacity: 0.5;
  cursor: default;
}
.dg-stats {
  opacity: 0.55;
  font-size: 11px;
}
.dg-warnbar {
  background: rgba(240, 160, 32, 0.15);
  border: 1px solid rgba(240, 160, 32, 0.4);
  border-radius: 6px;
  padding: 4px 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
.dg-notice {
  background: rgba(99, 226, 183, 0.15);
  border-radius: 6px;
  padding: 3px 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
.dg-error {
  background: rgba(232, 128, 128, 0.15);
  border-radius: 6px;
  padding: 3px 8px;
  margin-bottom: 6px;
  font-size: 12px;
}
.dg-list {
  flex: 1;
  overflow-y: auto;
  border: 1px solid rgba(128, 128, 128, 0.2);
  border-radius: 6px;
}
.dg-loading {
  padding: 18px;
  text-align: center;
  opacity: 0.6;
}
.dg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-bottom: 1px solid rgba(128, 128, 128, 0.12);
}
.dg-row:hover {
  background: rgba(128, 128, 128, 0.08);
}
.dg-rank {
  width: 20px;
  opacity: 0.5;
  text-align: right;
}
.dg-name {
  flex: 1;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dg-wr {
  width: 62px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.dg-wr.up {
  color: #63e2b7;
}
.dg-wr.down {
  color: #e88080;
}
.dg-stars {
  width: 40px;
  color: #f0c040;
  font-size: 11px;
  letter-spacing: 1px;
}
.dg-mastery {
  width: 72px;
  text-align: right;
  font-size: 11px;
  opacity: 0.8;
  font-variant-numeric: tabular-nums;
}
.dg-mastery em {
  font-style: normal;
  color: #63e2b7;
}
.dg-mastery.dim {
  opacity: 0.3;
}
.dg-pick {
  padding: 1px 10px;
  border: none;
  border-radius: 4px;
  background: rgba(99, 226, 183, 0.3);
  cursor: pointer;
  font-size: 12px;
}
.dg-pick:disabled {
  opacity: 0.35;
  cursor: default;
}
.dg-details {
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.8;
}
.dg-warnline {
  padding: 1px 0 1px 12px;
  opacity: 0.75;
}
.dg-footer {
  margin-top: 6px;
  font-size: 11px;
  opacity: 0.45;
}
</style>
