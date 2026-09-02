<template>
  <div class="pg-root">
    <!-- 顶栏：可拖拽 -->
    <header class="pg-header">
      <span class="pg-title">赛后小结</span>
      <span v-if="weightsNote" class="pg-weights">{{ weightsNote }}</span>
      <NButton class="no-drag ml-auto" size="tiny" quaternary circle title="关闭" @click="winop('hide')">
        <template #icon>
          <NIcon><CloseIcon /></NIcon>
        </template>
      </NButton>
    </header>

    <!-- 状态：等待 / 拉取 / 失败 -->
    <div v-if="state.phase !== 'ready'" class="pg-center">
      <NSpin v-if="state.phase === 'loading'" size="small" />
      <div class="pg-hint">{{ hintText }}</div>
    </div>

    <template v-else-if="view">
      <!-- 头部：本局英雄 + 游戏 ID + 胜负 -->
      <section class="pg-hero" :class="view.me.win ? 'pg-hero-win' : 'pg-hero-loss'">
        <div class="pg-hero-main">
          <ChampionIcon :champion-id="view.me.championId" class="pg-hero-champ" round />
          <div class="min-w-0">
            <div class="pg-hero-name" :title="view.me.name">{{ view.me.name }}</div>
            <div class="pg-hero-sub">{{ view.me.championName }} · {{ view.me.positionText }}</div>
          </div>
          <div class="pg-result" :class="view.me.win ? 'pg-result-win' : 'pg-result-loss'">
            {{ view.me.win ? '胜' : '负' }}
          </div>
        </div>
        <div class="pg-hero-stats">
          <div class="pg-stat">
            <div class="pg-stat-value">{{ view.durationText }}</div>
            <div class="pg-stat-label">本局时长</div>
          </div>
          <div class="pg-stat">
            <div class="pg-stat-value" :class="ratingClass(view.me.rating)">
              {{ formatAkariRating(view.me.rating) }}
              <span v-if="view.me.tag" class="pg-tag" :class="view.me.tagClass">{{ view.me.tag }}</span>
            </div>
            <div class="pg-stat-label">对局评分</div>
          </div>
          <div class="pg-stat">
            <div class="pg-stat-value">
              {{ view.me.kills }}<span class="pg-sep">/</span
              ><span class="text-red-300">{{ view.me.deaths }}</span
              ><span class="pg-sep">/</span>{{ view.me.assists }}
            </div>
            <div class="pg-stat-label">K / D / A</div>
          </div>
        </div>
      </section>

      <!-- 双方列表 -->
      <section class="pg-teams">
        <div v-for="team of view.teams" :key="team.key" class="pg-team">
          <div class="pg-team-title" :class="team.win ? 'text-emerald-300' : 'text-red-300'">
            {{ team.isMine ? '我方' : '敌方' }} · {{ team.win ? '胜利' : '失败' }}
          </div>
          <div class="pg-row pg-row-head">
            <span class="pg-col-name">玩家</span>
            <span class="pg-col-kda">K/D/A</span>
            <span class="pg-col-rating">评分</span>
          </div>
          <div
            v-for="row of team.rows"
            :key="row.puuid"
            class="pg-row"
            :class="{ 'pg-row-me': row.isMe }"
          >
            <span class="pg-col-name">
              <ChampionIcon :champion-id="row.championId" class="pg-row-champ" round />
              <span class="pg-row-name" :title="row.name">{{ row.name }}</span>
              <span class="pg-row-pos">{{ row.positionText }}</span>
            </span>
            <span class="pg-col-kda">{{ row.kills }}/{{ row.deaths }}/{{ row.assists }}</span>
            <span class="pg-col-rating">
              <span :class="ratingClass(row.rating)">{{ formatAkariRating(row.rating) }}</span>
              <span v-if="row.tag" class="pg-tag" :class="row.tagClass">{{ row.tag }}</span>
            </span>
          </div>
        </div>
      </section>

      <footer class="pg-footer">
        <span class="pg-footnote">{{ view.footnote }}</span>
        <NButton class="no-drag" size="tiny" secondary @click="winop('hide')">关闭</NButton>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import {
  type AkariScore,
  type AkariScorePosition,
  computeAkariScores,
  formatAkariRating
} from '@renderer-shared/components/match-card/utils/akari-score'
import { parseStoredCalibration } from '@renderer-shared/components/match-card/utils/akari-score-calibration'
import { buildAkariScoreInputs } from '@renderer-shared/components/match-card/utils/akari-score-input'
import { useAkariResourceProvider } from '@renderer-shared/providers/akari-resource'
import { useInstance } from '@renderer-shared/shards'
import { AkariIpcRenderer } from '@renderer-shared/shards/ipc'
import { LeagueClientRenderer } from '@renderer-shared/shards/league-client'
import { useLeagueClientStore } from '@renderer-shared/shards/league-client/store'
import { useMatchRatingStore } from '@renderer-shared/shards/match-rating/store'
import { SgpRenderer } from '@renderer-shared/shards/sgp'
import { useSgpStore } from '@renderer-shared/shards/sgp/store'
import { MAIN_SHARD_NAMESPACE_POST_GAME_WINDOW } from '@renderer-shared/shards/window-manager/context'
import { toBasicInfo } from '@shared/data-adapter/match-history/match-basic'
import { toParticipants } from '@shared/data-adapter/match-history/participants'
import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import { Close as CloseIcon } from '@vicons/ionicons5'
import { NButton, NIcon, NSpin } from 'naive-ui'
import { computed, onBeforeUnmount, reactive, watch } from 'vue'

const NS = MAIN_SHARD_NAMESPACE_POST_GAME_WINDOW
const ipc = useInstance(AkariIpcRenderer)
const lc = useInstance(LeagueClientRenderer)
const sgp = useInstance(SgpRenderer)
const sgps = useSgpStore()
const lcs = useLeagueClientStore()
const mrs = useMatchRatingStore()
const resources = useAkariResourceProvider()

const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 20
const END_PHASES = new Set(['PreEndOfGame', 'EndOfGame'])
const POSITION_TEXT: Record<AkariScorePosition, string> = {
  TOP: '上路',
  JUNGLE: '打野',
  MIDDLE: '中路',
  BOTTOM: '下路',
  UTILITY: '辅助',
  UNKNOWN: ''
}

const state = reactive<{
  phase: 'idle' | 'loading' | 'ready' | 'error'
  gameId: number | null
  attempts: number
  summary: LcuOrSgpGameSummary | null
  error: string
}>({ phase: 'idle', gameId: null, attempts: 0, summary: null, error: '' })

let pollTimer: ReturnType<typeof setTimeout> | null = null
let seq = 0

function winop(action: 'hide' | 'close') {
  ipc.call(NS, 'winop', { action }).catch(() => {})
}

function stopPolling() {
  seq++
  if (pollTimer) {
    clearTimeout(pollTimer)
    pollTimer = null
  }
}

/** 优先 SGP（字段最全，评分最准）；不可用或尚未入库时回落 LCU 单局接口 */
async function fetchSummary(gameId: number): Promise<LcuOrSgpGameSummary | null> {
  const me = lcs.summoner.me?.puuid
  if (me && sgps.availability.serversSupported.matchHistory) {
    try {
      const { data } = await sgp.api.matchHistoryQuery.getMatchHistorySummaryByPlayerPuuid(me, {
        startIndex: 0,
        count: 3,
        __sgpServerId: sgps.availability.sgpServerId
      })
      const hit = (data?.games ?? []).find((g: any) => Number(g?.json?.gameId) === gameId)
      if (hit) return { gameId, source: 'sgp', data: hit }
    } catch {}
  }
  try {
    const { data } = await lc.api.matchHistory.getGame(gameId)
    if (data && Array.isArray((data as any).participants) && (data as any).participants.length) {
      return { gameId, source: 'lcu', data }
    }
  } catch {}
  return null
}

function startLoading(gameId: number) {
  stopPolling()
  const mySeq = seq
  state.gameId = gameId
  state.phase = 'loading'
  state.attempts = 0
  state.summary = null
  state.error = ''
  const tick = async () => {
    if (mySeq !== seq) return
    state.attempts++
    const summary = await fetchSummary(gameId)
    if (mySeq !== seq) return
    if (summary) {
      state.summary = summary
      state.phase = 'ready'
      return
    }
    if (state.attempts >= POLL_MAX_ATTEMPTS) {
      state.phase = 'error'
      state.error = '本局战绩暂未入库，稍后可在战绩页查看'
      return
    }
    pollTimer = setTimeout(tick, POLL_INTERVAL_MS)
  }
  void tick()
}

// 结算相位一到就记下本局 gameId 并开始拉取（此时 gameflow 会话仍带 gameData）
watch(
  () => [lcs.gameflow.phase, (lcs.gameflow.session as any)?.gameData?.gameId] as const,
  ([phase, gameId]) => {
    if (!END_PHASES.has(String(phase))) return
    const id = Number(gameId)
    if (!Number.isFinite(id) || id <= 0 || id === state.gameId) return
    startLoading(id)
  },
  { immediate: true }
)

onBeforeUnmount(stopPolling)

const hintText = computed(() => {
  if (state.phase === 'loading') return `正在获取本局数据…（${state.attempts}/${POLL_MAX_ATTEMPTS}）`
  if (state.phase === 'error') return state.error
  return '对局结算后自动显示本局评分'
})

const weightsNote = computed(() => {
  const c = parseStoredCalibration(mrs.settings.calibration)
  return c ? `权重：基于 ${c.sourceName ?? '你'} ${c.games} 场校准` : '权重：内置'
})

function ratingClass(r: number) {
  if (r >= 8) return 'text-amber-300'
  if (r >= 6) return 'text-emerald-300'
  if (r >= 4) return 'text-white'
  return 'text-red-300'
}

function tagOf(s: AkariScore | undefined) {
  if (!s) return { tag: '', tagClass: '' }
  if (s.isMvp) return { tag: 'MVP', tagClass: 'pg-tag-mvp' }
  if (s.isSvp) return { tag: 'SVP', tagClass: 'pg-tag-svp' }
  if (s.isCarryLoss) return { tag: '尽力局', tagClass: 'pg-tag-carry' }
  return { tag: '', tagClass: '' }
}

const view = computed(() => {
  const summary = state.summary
  const myPuuid = lcs.summoner.me?.puuid
  if (!summary || !myPuuid) return null
  try {
    const basicInfo = toBasicInfo(summary)
    if (!basicInfo.isTwoTeam) return null
    const participants = toParticipants(summary, basicInfo)
    const { inputs, earlySurrender } = buildAkariScoreInputs(summary, participants)
    const scores = computeAkariScores(inputs, basicInfo.gameDuration, { earlySurrender })
    const me = participants.find((p) => p.puuid === myPuuid)
    if (!me) return null

    const minutes = Math.floor(basicInfo.gameDuration / 60)
    const seconds = basicInfo.gameDuration % 60
    const durationText = `${minutes}:${String(seconds).padStart(2, '0')}`

    const rowOf = (p: (typeof participants)[number]) => {
      const s = scores.byPuuid.get(p.puuid)
      const { tag, tagClass } = tagOf(s)
      return {
        puuid: p.puuid,
        isMe: p.puuid === myPuuid,
        championId: p.championId,
        name: p.tagLine ? `${p.gameName}#${p.tagLine}` : p.gameName,
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        rating: s?.rating ?? 0,
        positionText: s ? POSITION_TEXT[s.position] : '',
        tag,
        tagClass,
        win: p.win
      }
    }

    const teamIds = [...new Set(participants.map((p) => p.teamIdentifier))]
    const teams = teamIds
      .map((key) => {
        const members = participants.filter((p) => p.teamIdentifier === key)
        const rows = members.map(rowOf).sort((a, b) => b.rating - a.rating)
        return { key, isMine: key === me.teamIdentifier, win: members[0]?.win ?? false, rows }
      })
      .sort((a, b) => Number(b.isMine) - Number(a.isMine))

    const myRow = rowOf(me)
    const footnote = scores.skipped
      ? '本局为提前投降/重开，不计评分'
      : `对局评分：分路加权 · 局内相对 · 详情见战绩页 · ${basicInfo.dataSource === 'sgp' ? '数据源 SGP' : '数据源 LCU'}`
    return {
      durationText,
      me: {
        ...myRow,
        championName: resources.champions.name(me.championId)
      },
      teams,
      footnote
    }
  } catch {
    return null
  }
})
</script>

<style scoped>
.pg-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #141416;
  color: #e6e6e6;
  font-size: 12px;
  user-select: none;
}
.pg-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 10px 0 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}
.pg-title {
  font-weight: 700;
  font-size: 13px;
}
.pg-weights {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pg-center {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}
.pg-hint {
  color: rgba(255, 255, 255, 0.55);
}
.pg-hero {
  padding: 12px 14px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.pg-hero-win {
  background: linear-gradient(180deg, rgba(16, 185, 129, 0.16), transparent);
}
.pg-hero-loss {
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.16), transparent);
}
.pg-hero-main {
  display: flex;
  align-items: center;
  gap: 10px;
}
.pg-hero-champ {
  width: 44px;
  height: 44px;
  flex-shrink: 0;
}
.pg-hero-name {
  font-size: 15px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pg-hero-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
}
.pg-result {
  margin-left: auto;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  font-size: 16px;
  border: 2px solid currentColor;
}
.pg-result-win {
  color: #fbbf24;
}
.pg-result-loss {
  color: #9ca3af;
}
.pg-hero-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 12px;
  text-align: center;
}
.pg-stat-value {
  font-size: 16px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}
.pg-stat-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.5);
  margin-top: 2px;
}
.pg-sep {
  color: rgba(255, 255, 255, 0.35);
  margin: 0 1px;
}
.pg-teams {
  flex: 1;
  overflow: auto;
  padding: 6px 10px;
}
.pg-team {
  margin-bottom: 8px;
}
.pg-team-title {
  font-size: 11px;
  font-weight: 700;
  padding: 4px 4px 2px;
}
.pg-row {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 6px;
  border-radius: 4px;
}
.pg-row-head {
  height: 20px;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
}
.pg-row-me {
  background: rgba(255, 255, 255, 0.07);
}
.pg-col-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}
.pg-row-champ {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
}
.pg-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pg-row-me .pg-row-name {
  font-weight: 700;
}
.pg-row-pos {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
}
.pg-col-kda {
  width: 64px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.8);
}
.pg-col-rating {
  width: 82px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.pg-tag {
  font-size: 9px;
  line-height: 14px;
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 700;
}
.pg-tag-mvp {
  background: rgba(245, 158, 11, 0.25);
  color: #fcd34d;
}
.pg-tag-svp {
  background: rgba(14, 165, 233, 0.25);
  color: #7dd3fc;
}
.pg-tag-carry {
  background: rgba(139, 92, 246, 0.25);
  color: #c4b5fd;
}
.pg-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.pg-footnote {
  flex: 1;
  min-width: 0;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
