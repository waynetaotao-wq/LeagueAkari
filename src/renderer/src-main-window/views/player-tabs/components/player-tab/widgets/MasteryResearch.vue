<template>
  <div class="mb-3 rounded-lg bg-black/5 px-3 py-2 text-[12px] dark:bg-white/5">
    <!-- 头部（两行：窄侧栏下标题说明与控件互不挤压） -->
    <div class="flex min-w-0 items-center gap-2">
      <span class="shrink-0 font-bold text-black/85 dark:text-white/90">绝活研究</span>
      <span
        class="min-w-0 flex-1 truncate text-[11px] text-black/45 dark:text-white/40"
        title="研究他某个英雄的符文 / 召唤师 / 初装规律与对线单杀时机"
      >
        研究他某个英雄的符文 / 召唤师 / 初装规律与对线单杀时机
      </span>
    </div>
    <div class="mt-1 flex items-center gap-2">
      <div class="flex min-w-0 items-center gap-2">
        <NSelect
          v-model:value="range"
          size="tiny"
          class="w-26"
          :options="rangeOptions"
          :disabled="phase === 'list' || phase === 'facts'"
        />
        <NSelect
          v-model:value="versionFilter"
          size="tiny"
          class="w-40"
          :consistent-menu-width="false"
          :options="versionOptions"
          :disabled="phase === 'list' || phase === 'facts' || !listItems.length"
        />
        <NButton
          size="tiny"
          secondary
          :loading="phase === 'list'"
          :disabled="crossRegionBlocked || phase === 'facts'"
          @click="startAnalyze"
        >
          {{ listItems.length ? '重新拉取' : '开始分析' }}
        </NButton>
        <span
          class="cursor-pointer select-none text-black/50 dark:text-white/45"
          @click="collapsed = !collapsed"
        >
          {{ collapsed ? '▸' : '▾' }}
        </span>
      </div>
    </div>

    <template v-if="!collapsed">
      <div v-if="crossRegionBlocked" class="mt-2 text-[11px] text-black/50 dark:text-white/45">
        跨区召唤师暂不支持绝活研究（本机客户端接口仅覆盖本区战绩）
      </div>

      <template v-else>
        <!-- 阶段进度 -->
        <div v-if="phase === 'list'" class="mt-2 flex items-center gap-2">
          <NSpin :size="12" />
          <span class="text-black/55 dark:text-white/50">
            拉取最近战绩 {{ progressDone }}/{{ progressTotal }}…
          </span>
        </div>

        <!-- 英雄清单 -->
        <div v-if="champSummaries.length" class="mt-2">
          <div class="mb-1 text-[11px] text-black/50 dark:text-white/45">
            选择要研究的英雄（最近 {{ listItems.length }} 场经典模式）：
          </div>
          <div class="flex flex-wrap gap-1.5">
            <div
              v-for="c of champSummaries.slice(0, 18)"
              :key="c.championId"
              class="flex cursor-pointer select-none items-center gap-1 rounded px-1.5 py-0.5"
              :class="
                selectedChampion === c.championId
                  ? 'bg-emerald-600/25 ring-1 ring-emerald-500/60'
                  : 'bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/15'
              "
              @click="pickChampion(c.championId)"
            >
              <ChampionIcon round class="size-4.5 shrink-0" :champion-id="c.championId" />
              <span class="tabular-nums text-black/70 dark:text-white/70">
                {{ c.games }}场 {{ pct(c.wins, c.games) }}
              </span>
            </div>
          </div>
        </div>

        <div v-if="phase === 'facts'" class="mt-2 flex items-center gap-2">
          <NSpin :size="12" />
          <span class="text-black/55 dark:text-white/50">
            分析对局（详情+时间线） {{ progressDone }}/{{ progressTotal }}…
          </span>
        </div>

        <!-- 对位筛选 -->
        <div v-if="phase === 'done' && facts.length" class="mt-2">
          <div class="mb-1 text-[11px] text-black/50 dark:text-white/45">
            对位筛选（他这个英雄的同分路对手）：
          </div>
          <div class="flex flex-wrap gap-1.5">
            <div
              class="cursor-pointer select-none rounded px-2 py-0.5"
              :class="
                selectedOpp === 0
                  ? 'bg-emerald-600/25 ring-1 ring-emerald-500/60'
                  : 'bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/15'
              "
              @click="selectedOpp = 0"
            >
              全部（{{ facts.length }}场）
            </div>
            <div
              v-for="o of opponentSummaries.slice(0, 16)"
              :key="o.championId"
              class="flex cursor-pointer select-none items-center gap-1 rounded px-1.5 py-0.5"
              :class="
                selectedOpp === o.championId
                  ? 'bg-emerald-600/25 ring-1 ring-emerald-500/60'
                  : 'bg-black/10 hover:bg-black/20 dark:bg-white/10 dark:hover:bg-white/15'
              "
              @click="selectedOpp = o.championId"
            >
              <ChampionIcon round class="size-4.5 shrink-0" :champion-id="o.championId" />
              <span class="tabular-nums text-black/70 dark:text-white/70">{{ o.games }}场</span>
            </div>
          </div>
        </div>

        <!-- 统计结果 -->
        <template v-if="phase === 'done' && agg && agg.totalGames > 0">
          <div class="mt-2 flex items-center gap-2">
            <span class="font-bold text-black/80 dark:text-white/85">
              {{ scopeTitle }}：{{ agg.totalGames }} 场 · 胜率 {{ pct(agg.wins, agg.totalGames) }}
            </span>
            <span v-if="agg.totalGames < 5" class="text-[11px] text-amber-500/90">
              样本较少，仅供参考
            </span>
          </div>

          <!-- 单杀时机（选中对位时） -->
          <div
            v-if="selectedOpp !== 0"
            class="mt-1.5 rounded bg-black/10 px-2 py-1.5 dark:bg-white/8"
          >
            <template v-if="agg.soloSampleGames > 0">
              <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span class="min-w-0">
                  ⚔ 首次单杀对位：
                  <template v-if="agg.firstSoloKill.games > 0">
                    <b>{{ agg.firstSoloKill.games }}/{{ agg.soloSampleGames }}</b> 局发生 ·
                    <template v-for="(b, bi) of bucketRows(agg.firstSoloKill)" :key="bi">
                      <b v-if="bi === 0" class="text-emerald-500">{{ b }}</b>
                      <template v-else> · {{ b }}</template>
                    </template>
                  </template>
                  <template v-else>{{ agg.soloSampleGames }} 局中从未发生</template>
                </span>
                <span class="min-w-0">
                  💀 首次被对位单杀：
                  <template v-if="agg.firstSoloDeath.games > 0">
                    <b>{{ agg.firstSoloDeath.games }}/{{ agg.soloSampleGames }}</b> 局发生 ·
                    <template v-for="(b, bi) of bucketRows(agg.firstSoloDeath)" :key="bi">
                      <b v-if="bi === 0" class="text-red-400">{{ b }}</b>
                      <template v-else> · {{ b }}</template>
                    </template>
                  </template>
                  <template v-else>{{ agg.soloSampleGames }} 局中从未发生</template>
                </span>
              </div>
            </template>
            <div v-else class="text-black/50 dark:text-white/45">
              该对位对局缺少时间线数据，单杀时机不可统计
            </div>
          </div>

          <!-- 召唤师技能规律 -->
          <div class="mt-1.5">
            <div class="mb-0.5 text-[11px] font-bold text-black/60 dark:text-white/55">
              召唤师技能组合
            </div>
            <div
              v-for="s of agg.spellCombos.slice(0, 4)"
              :key="s.key"
              class="flex items-center py-px"
            >
              <span class="flex min-w-0 items-center gap-1">
                <SummonerSpellDisplay
                  v-for="(id, si) of s.ids"
                  :key="si"
                  :spell-id="id"
                  :size="18"
                />
              </span>
              <span class="ml-auto shrink-0 tabular-nums text-black/55 dark:text-white/50">
                {{ s.games }}场 · 胜率 {{ pct(s.wins, s.games) }}
              </span>
            </div>
          </div>

          <!-- 符文规律 -->
          <div class="mt-1.5">
            <div class="mb-0.5 text-[11px] font-bold text-black/60 dark:text-white/55">
              符文页组合
            </div>
            <div v-for="r of agg.runePages.slice(0, 4)" :key="r.key" class="py-px">
              <div class="flex items-center">
                <span class="flex min-w-0 items-center gap-1">
                  <PerkDisplay :perk-id="r.keystone" :size="22" />
                  <PerkstyleDisplay :perkstyle-id="r.primaryStyle" :size="16" />
                  <span class="text-[10px] text-black/40 dark:text-white/35">→</span>
                  <PerkstyleDisplay :perkstyle-id="r.subStyle" :size="16" />
                </span>
                <span class="ml-auto shrink-0 tabular-nums text-black/55 dark:text-white/50">
                  {{ r.games }}场 · 胜率 {{ pct(r.wins, r.games) }}
                </span>
              </div>
              <div class="mt-0.5 flex items-center gap-1">
                <PerkDisplay
                  v-for="(pid, ri) of r.perks.slice(1)"
                  :key="ri"
                  :perk-id="pid"
                  :size="14"
                />
              </div>
            </div>
          </div>

          <!-- 初装规律 -->
          <div class="mt-1.5">
            <div class="mb-0.5 text-[11px] font-bold text-black/60 dark:text-white/55">
              初装组合（开局 90 秒内购买）
            </div>
            <template v-if="agg.starterSampleGames > 0">
              <div
                v-for="s of agg.starterCombos.slice(0, 4)"
                :key="s.key"
                class="flex items-center py-px"
              >
                <span class="flex min-w-0 items-center gap-1">
                  <ItemDisplay v-for="(id, ii) of s.ids" :key="ii" :item-id="id" :size="18" />
                </span>
                <span class="ml-auto shrink-0 tabular-nums text-black/55 dark:text-white/50">
                  {{ s.games }}场 · 胜率 {{ pct(s.wins, s.games) }}
                </span>
              </div>
            </template>
            <div v-else class="text-black/50 dark:text-white/45">
              需要装备购买时间线（外服客户端可能不提供），暂无法统计
            </div>
          </div>

          <!-- 对线核心装 -->
          <div class="mt-1.5">
            <div class="mb-0.5 text-[11px] font-bold text-black/60 dark:text-white/55">
              前三件核心装（按购买顺序）
            </div>
            <template v-if="agg.coreSampleGames > 0 && agg.coreCombos.length">
              <div
                v-for="s2 of agg.coreCombos.slice(0, 4)"
                :key="s2.key"
                class="flex items-center py-px"
              >
                <span class="flex min-w-0 items-center gap-1">
                  <ItemDisplay
                    v-for="(id, ii) of s2.ids"
                    :key="ii"
                    :item-id="id"
                    :size="18"
                  />
                </span>
                <span class="ml-auto shrink-0 tabular-nums text-black/55 dark:text-white/50">
                  {{ s2.games }}场 · 胜率 {{ pct(s2.wins, s2.games) }}
                </span>
              </div>
            </template>
            <div v-else class="text-black/50 dark:text-white/45">
              需要装备购买时间线（外服客户端可能不提供），暂无法统计
            </div>
          </div>

          <!-- 鞋子 -->
          <div v-if="agg.bootsStats.length" class="mt-1.5">
            <div class="mb-0.5 text-[11px] font-bold text-black/60 dark:text-white/55">鞋子</div>
            <div
              v-for="s2 of agg.bootsStats.slice(0, 3)"
              :key="s2.key"
              class="flex items-center py-px"
            >
              <span class="flex min-w-0 items-center gap-1">
                <ItemDisplay :item-id="s2.ids[0]" :size="18" />
              </span>
              <span class="ml-auto shrink-0 tabular-nums text-black/55 dark:text-white/50">
                {{ s2.games }}场 · 胜率 {{ pct(s2.wins, s2.games) }}
              </span>
            </div>
          </div>

          <!-- 逐局明细 -->
          <div class="mt-1.5">
            <div
              class="cursor-pointer select-none text-[11px] font-bold text-black/60 dark:text-white/55"
              @click="detailOpen = !detailOpen"
            >
              逐局明细 {{ detailOpen ? '▾' : '▸' }}
            </div>
            <template v-if="detailOpen">
              <div
                v-for="f of scopedFacts.slice(0, 30)"
                :key="f.gameId"
                class="flex items-center gap-2 py-px text-[11px]"
              >
                <span class="w-18 shrink-0 tabular-nums text-black/45 dark:text-white/40">
                  {{ fmtDate(f.gameCreation) }}
                </span>
                <span :class="f.win ? 'text-emerald-500' : 'text-red-400'">
                  {{ f.win ? '胜' : '负' }}
                </span>
                <span class="tabular-nums">{{ f.kills }}/{{ f.deaths }}/{{ f.assists }}</span>
                <template v-if="f.laneOpponent">
                  <span class="text-black/45 dark:text-white/40">vs</span>
                  <ChampionIcon
                    round
                    class="size-4 shrink-0"
                    :champion-id="f.laneOpponent.championId"
                  />
                </template>
                <span class="flex min-w-0 items-center gap-1">
                  <PerkDisplay :perk-id="f.keystone" :size="16" />
                  <SummonerSpellDisplay
                    v-for="(id, si) of f.spells"
                    :key="si"
                    :spell-id="id"
                    :size="16"
                  />
                </span>
              </div>
            </template>
          </div>
        </template>

        <div
          v-else-if="phase === 'done' && selectedChampion && !facts.length"
          class="mt-2 text-black/50 dark:text-white/45"
        >
          该英雄在所选范围内没有可分析的经典模式对局
        </div>

        <div v-if="errorText" class="mt-1.5 text-[11px] text-red-500">{{ errorText }}</div>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useInstance } from '@renderer-shared/shards'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import ItemDisplay from '@renderer-shared/components/widgets/ItemDisplay.vue'
import PerkDisplay from '@renderer-shared/components/widgets/PerkDisplay.vue'
import PerkstyleDisplay from '@renderer-shared/components/widgets/PerkstyleDisplay.vue'
import SummonerSpellDisplay from '@renderer-shared/components/widgets/SummonerSpellDisplay.vue'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { NButton, NSelect, NSpin } from 'naive-ui'
import { computed, ref, shallowRef, watch } from 'vue'

import { usePlayerTab } from '../context'
import {
  LEVEL_BUCKETS,
  type MasteryChampionSummary,
  type MasteryFetchApi,
  type MasteryGameFact,
  type MatchListItem,
  aggregate,
  fetchGameFacts,
  fetchListItems,
  fetchSgpAll,
  fetchTimelinesInto,
  normalizeTimeline,
  summarizeChampions
} from '../mastery-research'

const lc = useInstance(LeagueClientRenderer)
const sgp = useInstance(SgpRenderer)
const sgps = useSgpStore()
const resources = useAkariResourceProvider()
const { puuid, isCrossRegion, sgpServerId } = usePlayerTab()

const sgpUsable = computed(() => sgps.availability.serversSupported.matchHistory)
// SGP 可用时跨区照常研究（腾讯系跨区走 SGP 路由）；仅 SGP 不可用且跨区才拦
const crossRegionBlocked = computed(() => isCrossRegion.value && !sgpUsable.value)

const collapsed = ref(true)
const range = ref(100)
const rangeOptions = [
  { label: '最近 50', value: 50 },
  { label: '最近 100', value: 100 },
  { label: '最近 200', value: 200 },
  { label: '最近 500', value: 500 },
  { label: '最近 1000', value: 1000 }
]
const versionFilter = ref('all')

type Phase = 'idle' | 'list' | 'picked' | 'facts' | 'done'
const phase = ref<Phase>('idle')
const progressDone = ref(0)
const progressTotal = ref(0)
const errorText = ref('')
const detailOpen = ref(false)

const listItems = shallowRef<MatchListItem[]>([])
const champSummaries = computed<MasteryChampionSummary[]>(() => summarizeChampions(filteredItems.value))
const selectedChampion = ref(0)
const facts = shallowRef<MasteryGameFact[]>([])
let sgpFactCache = new Map<number, MasteryGameFact>()
const selectedOpp = ref(0)

let seq = 0
let abort: AbortController | null = null

const api: MasteryFetchApi = {
  getMatchHistory: async (p, b, e) => (await lc.api.matchHistory.getMatchHistory(p, b, e)).data,
  getGame: async (id) => (await lc.api.matchHistory.getGame(id)).data,
  getTimeline: async (id) => {
    // 原版构建页同款双通道：SGP 完整详情（含装备购买事件）优先，LCU 阉割版回落
    if (sgps.availability.serversSupported.matchHistory) {
      try {
        const { data } = await sgp.api.matchHistoryQuery.getGameDetailsByGameId(id, {
          __sgpServerId: sgpServerId.value
        })
        const tl = normalizeTimeline(data)
        if (tl) return tl
      } catch {}
    }
    const { data } = await lc.api.matchHistory.getTimeline(id)
    return normalizeTimeline(data) ?? (data as any)
  }
}

async function startAnalyze() {
  const mySeq = ++seq
  abort?.abort()
  abort = new AbortController()
  collapsed.value = false
  errorText.value = ''
  phase.value = 'list'
  progressDone.value = 0
  progressTotal.value = range.value
  listItems.value = []
  selectedChampion.value = 0
  facts.value = []
  selectedOpp.value = 0
  sgpFactCache = new Map()
  versionFilter.value = 'all'
  try {
    let items: MatchListItem[]
    if (sgpUsable.value) {
      const got = await fetchSgpAll(
        (startIndex, count) =>
          sgp.api.matchHistoryQuery
            .getMatchHistorySummaryByPlayerPuuid(puuid.value, {
              startIndex,
              count,
              __sgpServerId: sgpServerId.value
            })
            .then((r) => r.data),
        puuid.value,
        range.value,
        (d, t) => {
          if (mySeq === seq) {
            progressDone.value = d
            progressTotal.value = t
          }
        },
        abort.signal
      )
      items = got.items
      sgpFactCache = got.facts
    } else {
      items = await fetchListItems(
        api,
        puuid.value,
        range.value,
        (d, t) => {
          if (mySeq === seq) {
            progressDone.value = d
            progressTotal.value = t
          }
        },
        abort.signal
      )
    }
    if (mySeq !== seq) return
    listItems.value = items
    phase.value = 'picked'
    // 自动选中场次最多的绝活英雄
    if (champSummaries.value.length) {
      void pickChampion(champSummaries.value[0].championId)
    }
  } catch (error: any) {
    if (mySeq !== seq) return
    phase.value = 'idle'
    errorText.value = `拉取战绩失败：${error?.message ?? error}`
  }
}

async function pickChampion(championId: number) {
  if (phase.value === 'facts' || phase.value === 'list') return
  const mySeq = ++seq
  abort?.abort()
  abort = new AbortController()
  selectedChampion.value = championId
  selectedOpp.value = 0
  facts.value = []
  errorText.value = ''
  const gameIds = listItems.value
    .filter((it) => it.championId === championId)
    .map((it) => it.gameId)
  phase.value = 'facts'
  progressDone.value = 0
  progressTotal.value = gameIds.length
  try {
    if (sgpFactCache.size > 0) {
      // SGP 路：符文/召唤师/对位已随列表到手，仅逐局补时间线（初装/核心装/单杀）
      const got = gameIds
        .map((id) => sgpFactCache.get(id))
        .filter((f): f is MasteryGameFact => !!f)
      await fetchTimelinesInto(
        got,
        api.getTimeline,
        (d, t) => {
          if (mySeq === seq) {
            progressDone.value = d
            progressTotal.value = t
          }
        },
        abort.signal
      )
      if (mySeq !== seq) return
      facts.value = got
      phase.value = 'done'
    } else {
      const { facts: got } = await fetchGameFacts(
        api,
        puuid.value,
        gameIds,
        (d, t) => {
          if (mySeq === seq) {
            progressDone.value = d
            progressTotal.value = t
          }
        },
        abort.signal
      )
      if (mySeq !== seq) return
      facts.value = got
      phase.value = 'done'
    }
  } catch (error: any) {
    if (mySeq !== seq) return
    phase.value = 'done'
    errorText.value = `部分对局分析失败：${error?.message ?? error}`
  }
}

const versionOptions = computed(() => {
  const set = new Map<string, number>()
  for (const it of listItems.value) {
    if (it.gameVersion) set.set(it.gameVersion, (set.get(it.gameVersion) ?? 0) + 1)
  }
  // 只列最近 3 个小版本（当前 / 前一 / 前二），更旧的并入"全部版本"
  const opts = [...set.entries()]
    .sort((a, b) => b[0].localeCompare(a[0], undefined, { numeric: true }))
    .slice(0, 3)
    .map(([v, n]) => ({ label: `${v}（${n}场）`, value: v }))
  return [{ label: '全部版本', value: 'all' }, ...opts]
})

const filteredItems = computed(() =>
  versionFilter.value === 'all'
    ? listItems.value
    : listItems.value.filter((it) => it.gameVersion === versionFilter.value)
)

const opponentSummaries = computed(() => {
  const map = new Map<number, { championId: number; games: number }>()
  for (const f of facts.value) {
    if (!f.laneOpponent) continue
    const id = f.laneOpponent.championId
    const s = map.get(id) ?? { championId: id, games: 0 }
    s.games++
    map.set(id, s)
  }
  return [...map.values()].sort((a, b) => b.games - a.games)
})

const scopedFacts = computed(() => {
  let base = facts.value
  if (versionFilter.value !== 'all') {
    base = base.filter((f) => f.gameVersion === versionFilter.value)
  }
  return selectedOpp.value === 0
    ? base
    : base.filter((f) => f.laneOpponent?.championId === selectedOpp.value)
})

const itemGoldOf = (id: number): number | null => {
  try {
    const d = (resources as any).items?.display?.(id)
    return typeof d?.totalPrice === 'number' ? d.totalPrice : null
  } catch {
    return null
  }
}

const agg = computed(() =>
  phase.value === 'done' ? aggregate(scopedFacts.value, { itemGoldOf }) : null
)

const scopeTitle = computed(() => {
  const my = championName(selectedChampion.value)
  return selectedOpp.value === 0 ? `${my} 全部对局` : `${my} vs ${championName(selectedOpp.value)}`
})

// ===== 名字解析（防御式：资源提供器优先，缺失回落到本地 gameData 或 #id）=====
function championName(id: number) {
  return resources.champions.name(id)
}
/** 等级桶展示行：非零桶按占比降序，如「6级当级 43%」 */
function bucketRows(stat: { games: number; levelBuckets: number[] }): string[] {
  if (!stat.games) return []
  return stat.levelBuckets
    .map((n, i) => ({ n, i }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((x) => `${LEVEL_BUCKETS[x.i].label} ${Math.round((x.n / stat.games) * 100)}%`)
}

function pct(w: number, g: number) {
  return g > 0 ? `${((w / g) * 100).toFixed(0)}%` : '—'
}
function fmtDate(ts: number) {
  const d = new Date(ts)
  return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 切换召唤师页签（puuid 变化）时重置
watch(puuid, () => {
  seq++
  abort?.abort()
  phase.value = 'idle'
  listItems.value = []
  facts.value = []
  sgpFactCache = new Map()
  selectedChampion.value = 0
  selectedOpp.value = 0
  errorText.value = ''
})
</script>
