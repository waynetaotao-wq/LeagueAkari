import type {
  Game,
  GameTimeline,
  Participant
} from '@shared/types/league-client/match-history'
import { isPveQueue } from '@shared/types/league-client/match-history'

/**
 * [lolps] 绝活研究（Mastery Research）—— 核心逻辑（纯函数，可单测）
 *
 * 研究一名召唤师某个英雄（绝活）的打法规律：
 *   召唤师技能组合 / 符文页组合 / 出门装组合（开局 ≤90s 购买）/
 *   对线某英雄时「首次单杀 / 首次被单杀」的平均等级与平均时间。
 *
 * 数据全部来自本机客户端接口（列表 → 对局详情 → 对局时间线），
 * 编排函数只依赖注入的最小接口，方便测试与复用。
 */

// ==================================================================
// ============================ 可调区 ==============================
// ==================================================================

/** 出门装时间窗（毫秒）：开局该窗口内的购买视为初装 */
export const STARTER_WINDOW_MS = 90_000

/** 详情/时间线串行拉取的间隔（毫秒），保护客户端接口 */
export const FETCH_INTERVAL_MS = 40

/** 经典模式队列（排位单双/灵活/匹配/普通）；其余队列不纳入研究 */
const CLASSIC_QUEUES = new Set([420, 440, 430, 400, 490])

// ==================================================================
// ============================ 类型 ================================
// ==================================================================

export interface MasteryChampionSummary {
  championId: number
  games: number
  wins: number
}

/** 单局提炼结果（详情 + 可选时间线） */
export interface MasteryGameFact {
  gameId: number
  gameCreation: number
  gameDuration: number
  queueId: number
  win: boolean
  /** 本人 participantId */
  selfPid: number
  kills: number
  deaths: number
  assists: number
  /** 召唤师技能组合（升序，保证同组合聚为一键） */
  spells: [number, number]
  /** 符文：主系样式 / 基石 / 副系样式 / 六颗符文 */
  primaryStyle: number
  keystone: number
  subStyle: number
  perks: number[]
  /** 同分路对位（敌方）；判定不出为 null */
  laneOpponent: { participantId: number; championId: number } | null
  /** 出门装（≤90s 购买的 itemId 序列，按购买顺序，含重复）；无时间线为 null */
  starterItems: number[] | null
  /** 首次单杀对位：等级与时间；该局未发生为 null；无时间线为 undefined */
  firstSoloKill?: { level: number; timeMs: number } | null
  /** 首次被对位单杀 */
  firstSoloDeath?: { level: number; timeMs: number } | null
}

export interface ComboStat {
  key: string
  ids: number[]
  games: number
  wins: number
}

export interface RunePageStat {
  key: string
  primaryStyle: number
  keystone: number
  subStyle: number
  perks: number[]
  games: number
  wins: number
}

export interface SoloStat {
  /** 有该事件的局数 */
  games: number
  avgLevel: number | null
  avgTimeMs: number | null
}

export interface MasteryAggregate {
  totalGames: number
  wins: number
  spellCombos: ComboStat[]
  runePages: RunePageStat[]
  starterCombos: ComboStat[]
  /** 出门装可统计的局数（有时间线的局） */
  starterSampleGames: number
  /** 仅在选定对位时有意义 */
  firstSoloKill: SoloStat
  firstSoloDeath: SoloStat
  soloSampleGames: number
}

// ==================================================================
// ==================== 第一步：列表 → 英雄清单 ======================
// ==================================================================

export interface MatchListItem {
  gameId: number
  championId: number
  queueId: number
  gameMode: string
  win: boolean
  gameCreation: number
}

/** 从列表页原始 Game（简表：participants 只含本人）提炼列表项；非经典/PVE 返回 null */
export function toListItem(game: Game): MatchListItem | null {
  if (game.gameMode !== 'CLASSIC') return null
  if (isPveQueue(game.queueId)) return null
  if (!CLASSIC_QUEUES.has(game.queueId)) return null
  const p = game.participants?.[0]
  if (!p) return null
  return {
    gameId: game.gameId,
    championId: p.championId,
    queueId: game.queueId,
    gameMode: game.gameMode,
    win: p.stats?.win === true,
    gameCreation: game.gameCreation
  }
}

export function summarizeChampions(items: MatchListItem[]): MasteryChampionSummary[] {
  const map = new Map<number, MasteryChampionSummary>()
  for (const it of items) {
    let s = map.get(it.championId)
    if (!s) {
      s = { championId: it.championId, games: 0, wins: 0 }
      map.set(it.championId, s)
    }
    s.games++
    if (it.win) s.wins++
  }
  return [...map.values()].sort((a, b) => b.games - a.games)
}

// ==================================================================
// ==================== 第二步：详情 → 单局事实 ======================
// ==================================================================

/** 同分路对位判定：优先 timeline.lane/role 完全匹配；分路缺失回落 null */
export function resolveLaneOpponent(
  self: Participant,
  enemies: Participant[]
): { participantId: number; championId: number } | null {
  const lane = self.timeline?.lane
  const role = self.timeline?.role
  if (!lane || lane === 'NONE') return null
  let candidates = enemies.filter((e) => e.timeline?.lane === lane)
  if (candidates.length > 1 && lane === 'BOTTOM' && role) {
    const roleMatch = candidates.filter((e) => e.timeline?.role === role)
    if (roleMatch.length >= 1) candidates = roleMatch
  }
  if (candidates.length !== 1) return null
  return { participantId: candidates[0].participantId, championId: candidates[0].championId }
}

export function extractGameFact(game: Game, puuid: string): MasteryGameFact | null {
  const identity = game.participantIdentities?.find((pi) => pi.player?.puuid === puuid)
  if (!identity) return null
  const self = game.participants?.find((p) => p.participantId === identity.participantId)
  if (!self) return null
  const enemies = (game.participants ?? []).filter((p) => p.teamId !== self.teamId)

  const spells = [self.spell1Id, self.spell2Id].sort((a, b) => a - b) as [number, number]
  const st = self.stats
  const perks = [st.perk0, st.perk1, st.perk2, st.perk3, st.perk4, st.perk5].filter(
    (x) => typeof x === 'number' && x > 0
  )

  return {
    gameId: game.gameId,
    gameCreation: game.gameCreation,
    gameDuration: game.gameDuration,
    queueId: game.queueId,
    win: st.win === true,
    selfPid: self.participantId,
    kills: st.kills ?? 0,
    deaths: st.deaths ?? 0,
    assists: st.assists ?? 0,
    spells,
    primaryStyle: st.perkPrimaryStyle ?? 0,
    keystone: st.perk0 ?? 0,
    subStyle: st.perkSubStyle ?? 0,
    perks,
    laneOpponent: resolveLaneOpponent(self, enemies),
    starterItems: null
  }
}

// ==================================================================
// ================ 第三步：时间线 → 初装 / 单杀等级 =================
// ==================================================================

/** 事件时刻的等级：取时间戳不晚于事件的最后一帧的快照（帧间升级最多差 1 级） */
export function levelAt(timeline: GameTimeline, pid: number, timestamp: number): number {
  let level = 1
  for (const frame of timeline.frames ?? []) {
    if (frame.timestamp > timestamp) break
    const pf = frame.participantFrames?.[String(pid)]
    if (pf && typeof pf.level === 'number') level = pf.level
  }
  return level
}

export function applyTimeline(fact: MasteryGameFact, timeline: GameTimeline): void {
  // 初装：开局窗口内本人的购买（宽松识别：类型未在声明内也照收）
  const starters: number[] = []
  let firstSoloKill: { level: number; timeMs: number } | null = null
  let firstSoloDeath: { level: number; timeMs: number } | null = null
  const opp = fact.laneOpponent

  for (const frame of timeline.frames ?? []) {
    for (const ev of (frame.events ?? []) as any[]) {
      if (!ev || typeof ev !== 'object') continue
      if (
        ev.type === 'ITEM_PURCHASED' &&
        ev.participantId === fact.selfPid &&
        typeof ev.itemId === 'number' &&
        ev.timestamp <= STARTER_WINDOW_MS
      ) {
        starters.push(ev.itemId)
      }
      if (
        opp &&
        ev.type === 'CHAMPION_KILL' &&
        (ev.assistingParticipantIds?.length ?? 0) === 0
      ) {
        if (ev.killerId === fact.selfPid && ev.victimId === opp.participantId && !firstSoloKill) {
          firstSoloKill = {
            level: levelAt(timeline, fact.selfPid, ev.timestamp),
            timeMs: ev.timestamp
          }
        }
        if (ev.killerId === opp.participantId && ev.victimId === fact.selfPid && !firstSoloDeath) {
          firstSoloDeath = {
            level: levelAt(timeline, fact.selfPid, ev.timestamp),
            timeMs: ev.timestamp
          }
        }
      }
    }
  }

  fact.starterItems = starters
  if (opp) {
    fact.firstSoloKill = firstSoloKill
    fact.firstSoloDeath = firstSoloDeath
  }
}

// ==================================================================
// ========================= 聚合统计 ================================
// ==================================================================

function pushCombo(map: Map<string, ComboStat>, ids: number[], win: boolean) {
  const key = ids.join('-')
  let s = map.get(key)
  if (!s) {
    s = { key, ids: [...ids], games: 0, wins: 0 }
    map.set(key, s)
  }
  s.games++
  if (win) s.wins++
}

export function aggregate(facts: MasteryGameFact[]): MasteryAggregate {
  const spellMap = new Map<string, ComboStat>()
  const runeMap = new Map<string, RunePageStat>()
  const starterMap = new Map<string, ComboStat>()
  let wins = 0
  let starterSampleGames = 0
  let soloSampleGames = 0
  const soloKills: { level: number; timeMs: number }[] = []
  const soloDeaths: { level: number; timeMs: number }[] = []

  for (const f of facts) {
    if (f.win) wins++
    pushCombo(spellMap, f.spells, f.win)

    const rKey = `${f.primaryStyle}|${f.keystone}|${f.subStyle}|${f.perks.join(',')}`
    let r = runeMap.get(rKey)
    if (!r) {
      r = {
        key: rKey,
        primaryStyle: f.primaryStyle,
        keystone: f.keystone,
        subStyle: f.subStyle,
        perks: [...f.perks],
        games: 0,
        wins: 0
      }
      runeMap.set(rKey, r)
    }
    r.games++
    if (f.win) r.wins++

    if (f.starterItems !== null) {
      starterSampleGames++
      if (f.starterItems.length > 0) {
        // 组合键按 id 排序（购买顺序差异不拆分组合），展示时保留排序序列
        const sorted = [...f.starterItems].sort((a, b) => a - b)
        pushCombo(starterMap, sorted, f.win)
      }
    }

    if (f.firstSoloKill !== undefined) {
      soloSampleGames++
      if (f.firstSoloKill) soloKills.push(f.firstSoloKill)
      if (f.firstSoloDeath) soloDeaths.push(f.firstSoloDeath)
    }
  }

  const avg = (xs: number[]) =>
    xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10

  const byGames = <T extends { games: number }>(a: T, b: T) => b.games - a.games

  return {
    totalGames: facts.length,
    wins,
    spellCombos: [...spellMap.values()].sort(byGames),
    runePages: [...runeMap.values()].sort(byGames),
    starterCombos: [...starterMap.values()].sort(byGames),
    starterSampleGames,
    firstSoloKill: {
      games: soloKills.length,
      avgLevel: avg(soloKills.map((x) => x.level)),
      avgTimeMs: soloKills.length
        ? Math.round(soloKills.reduce((a, b) => a + b.timeMs, 0) / soloKills.length)
        : null
    },
    firstSoloDeath: {
      games: soloDeaths.length,
      avgLevel: avg(soloDeaths.map((x) => x.level)),
      avgTimeMs: soloDeaths.length
        ? Math.round(soloDeaths.reduce((a, b) => a + b.timeMs, 0) / soloDeaths.length)
        : null
    },
    soloSampleGames
  }
}

// ==================================================================
// ========================= 拉取编排 ================================
// ==================================================================

export interface MasteryFetchApi {
  getMatchHistory: (
    puuid: string,
    begIndex: number,
    endIndex: number
  ) => Promise<{ games: { games: Game[] } }>
  getGame: (gameId: number) => Promise<Game>
  getTimeline: (gameId: number) => Promise<GameTimeline>
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 拉取最近 range 条列表（20 条/页），按经典模式过滤 */
export async function fetchListItems(
  api: MasteryFetchApi,
  puuid: string,
  range: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<MatchListItem[]> {
  const items: MatchListItem[] = []
  const pageSize = 20
  const pages = Math.ceil(range / pageSize)
  for (let i = 0; i < pages; i++) {
    if (signal?.aborted) break
    const beg = i * pageSize
    const end = Math.min(range - 1, beg + pageSize - 1)
    const res = await api.getMatchHistory(puuid, beg, end)
    const games = res.games?.games ?? []
    for (const g of games) {
      const it = toListItem(g)
      if (it) items.push(it)
    }
    onProgress?.(Math.min(range, end + 1), range)
    if (games.length < end - beg + 1) break // 没有更多了
    await sleep(FETCH_INTERVAL_MS)
  }
  return items
}

/** 对选中英雄的对局逐局拉详情 + 时间线，产出单局事实（时间线失败不致命） */
export async function fetchGameFacts(
  api: MasteryFetchApi,
  puuid: string,
  gameIds: number[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ facts: MasteryGameFact[]; timelineFailures: number }> {
  const facts: MasteryGameFact[] = []
  let timelineFailures = 0
  const total = gameIds.length
  let done = 0
  for (const gameId of gameIds) {
    if (signal?.aborted) break
    try {
      const game = await api.getGame(gameId)
      const fact = extractGameFact(game, puuid)
      if (fact) {
        try {
          await sleep(FETCH_INTERVAL_MS)
          const tl = await api.getTimeline(gameId)
          applyTimeline(fact, tl)
        } catch {
          timelineFailures++
        }
        facts.push(fact)
      }
    } catch {
      // 单局详情失败：跳过该局
    }
    done++
    onProgress?.(done, total)
    await sleep(FETCH_INTERVAL_MS)
  }
  return { facts, timelineFailures }
}

export function formatGameTime(ms: number): string {
  const s = Math.round(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
