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
      <!-- 头图：本局英雄原画 + 本人信息 + 胜负 -->
      <section class="pg-hero" :class="view.me.win ? 'pg-hero-win' : 'pg-hero-loss'">
        <div v-if="view.me.splashUrl" class="pg-hero-bg" :style="{ backgroundImage: `url(${view.me.splashUrl})` }" />
        <div class="pg-hero-shade" />
        <div class="pg-hero-content">
          <div class="pg-hero-main">
            <div class="pg-hero-avatar" :class="view.me.win ? 'ring-win' : 'ring-loss'">
              <ChampionIcon :champion-id="view.me.championId" class="pg-hero-champ" round />
            </div>
            <div class="min-w-0 flex-1">
              <div class="pg-hero-name" :title="view.me.name">{{ view.me.name }}</div>
              <div class="pg-hero-sub">
                {{ view.me.championName }}<template v-if="view.me.positionText"> · {{ view.me.positionText }}</template>
                <template v-if="view.queueText"> · {{ view.queueText }}</template>
              </div>
              <div class="pg-chips mt-1.5">
                <span v-for="chip of view.me.chips" :key="chip.text" class="pg-tag" :class="chip.class">{{ chip.text }}</span>
                <AchievementIcon v-for="a of view.me.achievements" :key="a.key" :achievement="a" />
              </div>
            </div>
            <div class="pg-result" :class="view.me.win ? 'pg-result-win' : 'pg-result-loss'">
              <span class="pg-result-text">{{ view.me.win ? '胜' : '负' }}</span>
            </div>
          </div>

          <div class="pg-hero-stats">
            <div class="pg-stat">
              <div class="pg-stat-value">{{ view.durationText }}</div>
              <div class="pg-stat-label">本局时长</div>
            </div>
            <div class="pg-stat pg-stat-main">
              <div class="pg-stat-value pg-stat-rating" :class="ratingClass(view.me.rating)">
                {{ formatAkariRating(view.me.rating) }}
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
        </div>
      </section>

      <!-- 双方列表 -->
      <section class="pg-teams">
        <div v-for="team of view.teams" :key="team.key" class="pg-team">
          <div class="pg-team-head">
            <span class="pg-team-title" :class="team.win ? 'text-emerald-300' : 'text-red-300'">
              {{ team.isMine ? '我方' : '敌方' }} · {{ team.win ? '胜利' : '失败' }}
            </span>
            <span class="pg-team-kda">{{ team.kills }} / {{ team.deaths }} / {{ team.assists }}</span>
            <span class="pg-col-head-rating">评分</span>
          </div>
          <div
            v-for="row of team.rows"
            :key="row.puuid"
            class="pg-row"
            :class="{ 'pg-row-me': row.isMe }"
          >
            <ChampionIcon :champion-id="row.championId" class="pg-row-champ" round />
            <div class="pg-row-body">
              <div class="pg-row-line1">
                <span class="pg-row-name" :title="row.name">{{ row.name }}</span>
                <span v-if="row.positionText" class="pg-row-pos">{{ row.positionText }}</span>
              </div>
              <div class="pg-row-line2">
                <span v-for="chip of row.chips" :key="chip.text" class="pg-tag" :class="chip.class">{{ chip.text }}</span>
                <AchievementIcon v-for="a of row.achievements" :key="a.key" :achievement="a" />
              </div>
            </div>
            <span class="pg-col-kda">{{ row.kills }}/{{ row.deaths }}/{{ row.assists }}</span>
            <span class="pg-col-rating" :class="ratingClass(row.rating)">{{ formatAkariRating(row.rating) }}</span>
          </div>
        </div>
      </section>

      <footer class="pg-footer">
        <span class="pg-footnote">{{ view.footnote }}</span>
        <NButton class="no-drag" size="small" secondary @click="winop('hide')">关闭</NButton>
      </footer>
    </template>
  </div>
</template>

<script setup lang="ts">
import AchievementIcon from '@renderer-shared/components/match-card/widgets/AchievementIcon.vue'
import ChampionIcon from '@renderer-shared/components/widgets/ChampionIcon.vue'
import { computeAkariAchievements } from '@renderer-shared/components/match-card/utils/akari-achievements'
import {
  AKARI_GAME_TAG_LABELS,
  type AkariGameTag,
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
const QUEUE_TEXT: Record<number, string> = {
  420: '单双排',
  440: '灵活组排',
  400: '匹配',
  430: '匹配',
  490: '快速匹配',
  450: '极地大乱斗',
  1700: '斗魂竞技场'
}
const TAG_CLASS: Record<AkariGameTag, string> = {
  carry: 'pg-tag-sky',
  stomp: 'pg-tag-teal',
  lying: 'pg-tag-lime',
  effort: 'pg-tag-violet',
  blame: 'pg-tag-orange',
  afk: 'pg-tag-gray'
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

function chipsOf(s: AkariScore | undefined) {
  const out: Array<{ text: string; class: string }> = []
  if (!s) return out
  if (s.badge === 'MVP') out.push({ text: 'MVP', class: 'pg-tag-mvp' })
  if (s.badge === 'SVP') out.push({ text: 'SVP', class: 'pg-tag-svp' })
  if (s.tag) out.push({ text: AKARI_GAME_TAG_LABELS[s.tag], class: TAG_CLASS[s.tag] })
  return out
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
    const achievements = computeAkariAchievements(inputs, basicInfo.gameDuration)
    const me = participants.find((p) => p.puuid === myPuuid)
    if (!me) return null

    const minutes = Math.floor(basicInfo.gameDuration / 60)
    const seconds = basicInfo.gameDuration % 60
    const durationText = `${minutes}:${String(seconds).padStart(2, '0')}`

    const rowOf = (p: (typeof participants)[number]) => {
      const s = scores.byPuuid.get(p.puuid)
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
        chips: chipsOf(s),
        achievements: achievements.get(p.puuid) ?? [],
        win: p.win
      }
    }

    const teamIds = [...new Set(participants.map((p) => p.teamIdentifier))]
    const teams = teamIds
      .map((key) => {
        const members = participants.filter((p) => p.teamIdentifier === key)
        const rows = members.map(rowOf).sort((a, b) => b.rating - a.rating)
        return {
          key,
          isMine: key === me.teamIdentifier,
          win: members[0]?.win ?? false,
          kills: members.reduce((s, p) => s + p.kills, 0),
          deaths: members.reduce((s, p) => s + p.deaths, 0),
          assists: members.reduce((s, p) => s + p.assists, 0),
          rows
        }
      })
      .sort((a, b) => Number(b.isMine) - Number(a.isMine))

    const myRow = rowOf(me)
    const splashUrl = resources.assets.resolve(
      `/lol-game-data/assets/v1/champion-splashes/${me.championId}/${me.championId * 1000}.jpg`
    )
    const footnote = scores.skipped
      ? '本局为提前投降/重开，不计评分'
      : `对局评分：分路加权 · 局内相对 · 详情见战绩页 · ${basicInfo.dataSource === 'sgp' ? '数据源 SGP' : '数据源 LCU'}`
    return {
      durationText,
      queueText: QUEUE_TEXT[basicInfo.queueId] ?? '',
      me: {
        ...myRow,
        championName: resources.champions.name(me.championId),
        splashUrl
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
  padding: 0 10px 0 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  -webkit-app-region: drag;
}
.no-drag {
  -webkit-app-region: no-drag;
}
.pg-title {
  font-weight: 700;
  font-size: 13px;
  letter-spacing: 0.5px;
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

/* 头图 */
.pg-hero {
  position: relative;
  height: 232px;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.pg-hero-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center 20%;
  filter: saturate(0.9);
  transform: scale(1.04);
}
.pg-hero-shade {
  position: absolute;
  inset: 0;
  background:
    linear-gradient(180deg, rgba(20, 20, 22, 0.35) 0%, rgba(20, 20, 22, 0.72) 55%, rgba(20, 20, 22, 0.96) 100%),
    linear-gradient(90deg, rgba(20, 20, 22, 0.55) 0%, rgba(20, 20, 22, 0) 60%);
}
.pg-hero-win .pg-hero-shade {
  box-shadow: inset 0 -2px 0 rgba(16, 185, 129, 0.6);
}
.pg-hero-loss .pg-hero-shade {
  box-shadow: inset 0 -2px 0 rgba(239, 68, 68, 0.55);
}
.pg-hero-content {
  position: relative;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 18px 18px 14px;
}
.pg-hero-main {
  display: flex;
  align-items: center;
  gap: 14px;
}
.pg-hero-avatar {
  width: 68px;
  height: 68px;
  border-radius: 50%;
  padding: 3px;
  flex-shrink: 0;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
}
.ring-win {
  background: linear-gradient(135deg, #fbbf24, #f59e0b 60%, #b45309);
}
.ring-loss {
  background: linear-gradient(135deg, #9ca3af, #6b7280 60%, #374151);
}
.pg-hero-champ {
  width: 62px;
  height: 62px;
}
.pg-hero-name {
  font-size: 19px;
  font-weight: 800;
  letter-spacing: 0.3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.pg-hero-sub {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.7);
  margin-top: 2px;
}
.pg-result {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid currentColor;
  box-shadow: 0 0 18px rgba(0, 0, 0, 0.45);
  flex-shrink: 0;
}
.pg-result-text {
  font-weight: 900;
  font-size: 22px;
}
.pg-result-win {
  color: #fbbf24;
  background: radial-gradient(circle, rgba(251, 191, 36, 0.22), rgba(251, 191, 36, 0.04) 70%);
}
.pg-result-loss {
  color: #cbd5e1;
  background: radial-gradient(circle, rgba(148, 163, 184, 0.2), rgba(148, 163, 184, 0.04) 70%);
}
.pg-hero-stats {
  display: grid;
  grid-template-columns: 1fr 1.2fr 1fr;
  align-items: end;
  text-align: center;
}
.pg-stat-value {
  font-size: 20px;
  font-weight: 800;
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.pg-stat-rating {
  font-size: 30px;
}
.pg-stat-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.55);
  margin-top: 4px;
  letter-spacing: 1px;
}
.pg-sep {
  color: rgba(255, 255, 255, 0.35);
  margin: 0 2px;
}
.pg-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
}

/* 列表 */
.pg-teams {
  flex: 1;
  overflow: auto;
  padding: 8px 12px 4px;
}
.pg-team {
  margin-bottom: 10px;
}
.pg-team-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 6px 4px;
}
.pg-team-title {
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.5px;
}
.pg-team-kda {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.45);
  font-variant-numeric: tabular-nums;
}
.pg-col-head-rating {
  margin-left: auto;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  width: 52px;
  text-align: right;
}
.pg-row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 42px;
  padding: 0 6px;
  border-radius: 6px;
  border-left: 3px solid transparent;
}
.pg-row-me {
  background: rgba(255, 255, 255, 0.07);
  border-left-color: #fbbf24;
}
.pg-row-champ {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
}
.pg-row-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.pg-row-line1 {
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
}
.pg-row-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}
.pg-row-me .pg-row-name {
  font-weight: 700;
}
.pg-row-pos {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
}
.pg-row-line2 {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 16px;
  overflow: hidden;
}
.pg-col-kda {
  width: 64px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  color: rgba(255, 255, 255, 0.8);
  flex-shrink: 0;
}
.pg-col-rating {
  width: 52px;
  text-align: right;
  font-weight: 800;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  flex-shrink: 0;
}

/* 芯片 */
.pg-tag {
  font-size: 9px;
  line-height: 15px;
  padding: 0 5px;
  border-radius: 3px;
  font-weight: 700;
  white-space: nowrap;
}
.pg-tag-mvp {
  background: linear-gradient(135deg, rgba(245, 158, 11, 0.45), rgba(245, 158, 11, 0.2));
  color: #fde68a;
}
.pg-tag-svp {
  background: rgba(14, 165, 233, 0.3);
  color: #bae6fd;
}
.pg-tag-sky {
  background: rgba(14, 165, 233, 0.22);
  color: #7dd3fc;
}
.pg-tag-teal {
  background: rgba(20, 184, 166, 0.22);
  color: #5eead4;
}
.pg-tag-lime {
  background: rgba(132, 204, 22, 0.22);
  color: #bef264;
}
.pg-tag-violet {
  background: rgba(139, 92, 246, 0.22);
  color: #c4b5fd;
}
.pg-tag-orange {
  background: rgba(249, 115, 22, 0.22);
  color: #fdba74;
}
.pg-tag-gray {
  background: rgba(156, 163, 175, 0.22);
  color: #d1d5db;
}

/* 底部 */
.pg-footer {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
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
