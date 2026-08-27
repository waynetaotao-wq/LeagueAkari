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

/** 首次单杀/被单杀 等级分桶（高手视角：6 级当级单列是刺客签名） */
export const LEVEL_BUCKETS = [
  { key: '1-3', label: '1-3级', min: 1, max: 3 },
  { key: '4-5', label: '4-5级', min: 4, max: 5 },
  { key: '6', label: '6级当级', min: 6, max: 6 },
  { key: '7-8', label: '7-8级', min: 7, max: 8 },
  { key: '9+', label: '9级+', min: 9, max: 99 }
] as const

export function levelBucketIndex(level: number): number {
  const i = LEVEL_BUCKETS.findIndex((b) => level >= b.min && level <= b.max)
  return i >= 0 ? i : LEVEL_BUCKETS.length - 1
}

/** 成品鞋 id 清单（可调区：新版鞋在此追加） */
export const BOOTS_IDS: ReadonlySet<number> = new Set([
  3005, 3006, 3009, 3010, 3013, 3020, 3047, 3111, 3117, 3158, 2422
])

/** 大件判定阈值（总价 ≥ 此值视为核心装；价格由调用方注入） */
export const CORE_ITEM_GOLD = 1600

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
  /** 大版本号（如 "16.17"） */
  gameVersion: string
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
  /** 本人全量购买序列（按时间）；无时间线为 null */
  purchases: { itemId: number; ts: number }[] | null
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
  /** 各等级桶命中局数（与 LEVEL_BUCKETS 对齐） */
  levelBuckets: number[]
}

export interface MasteryAggregate {
  totalGames: number
  wins: number
  spellCombos: ComboStat[]
  runePages: RunePageStat[]
  starterCombos: ComboStat[]
  /** 前三件核心装组合（按购买顺序；依赖注入的价格表） */
  coreCombos: ComboStat[]
  /** 鞋子分布 */
  bootsStats: ComboStat[]
  /** 核心装可统计局数（有购买序列且价格表可用） */
  coreSampleGames: number
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
  /** 大版本号（如 "16.17"） */
  gameVersion: string
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
    gameCreation: game.gameCreation,
    gameVersion: shortVersion(game.gameVersion)
  }
}

export function shortVersion(v: string | undefined | null): string {
  if (!v) return ''
  return v.split('.').slice(0, 2).join('.')
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
    gameVersion: shortVersion(game.gameVersion),
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
    starterItems: null,
    purchases: null
  }
}

// ==================================================================
// ============ 第二步B：SGP 完整对局（Riot 形状）一步提炼 ============
// ==================================================================

/** SGP 战绩列表元素（{metadata, json}）→ 列表项 + 单局事实（符文/召唤师/对位一步到位） */
export function extractFromSgpGame(
  raw: any,
  puuid: string
): { item: MatchListItem; fact: MasteryGameFact } | null {
  const g = raw?.json ?? raw
  if (!g || g.gameMode !== 'CLASSIC') return null
  if (typeof g.queueId !== 'number' || isPveQueue(g.queueId)) return null
  if (!CLASSIC_QUEUES.has(g.queueId)) return null
  const parts: any[] = Array.isArray(g.participants) ? g.participants : []
  const self = parts.find((x) => x?.puuid === puuid)
  if (!self) return null

  const item: MatchListItem = {
    gameId: g.gameId,
    championId: self.championId,
    queueId: g.queueId,
    gameMode: g.gameMode,
    win: self.win === true,
    gameCreation: g.gameCreation ?? g.gameStartTimestamp ?? 0,
    gameVersion: shortVersion(g.gameVersion)
  }

  // 符文：Riot 形状 perks.styles[0]=主系(基石+3)、styles[1]=副系(2)
  const styles: any[] = self.perks?.styles ?? []
  const primary = styles[0] ?? {}
  const sub = styles[1] ?? {}
  const mainPerks: number[] = (primary.selections ?? [])
    .map((x: any) => x?.perk)
    .filter((x: any) => typeof x === 'number' && x > 0)
  const subPerks: number[] = (sub.selections ?? [])
    .map((x: any) => x?.perk)
    .filter((x: any) => typeof x === 'number' && x > 0)

  // 对位：teamPosition 最可靠，缺失回落 individualPosition
  const posOf = (x: any): string => x?.teamPosition || x?.individualPosition || ''
  const myPos = posOf(self)
  let laneOpponent: MasteryGameFact['laneOpponent'] = null
  if (myPos && myPos !== 'Invalid') {
    const cands = parts.filter((x) => x.teamId !== self.teamId && posOf(x) === myPos)
    if (cands.length === 1) {
      laneOpponent = { participantId: cands[0].participantId, championId: cands[0].championId }
    }
  }

  const fact: MasteryGameFact = {
    gameId: g.gameId,
    gameCreation: item.gameCreation,
    gameDuration: g.gameDuration ?? 0,
    queueId: g.queueId,
    win: self.win === true,
    gameVersion: item.gameVersion,
    selfPid: self.participantId,
    kills: self.kills ?? 0,
    deaths: self.deaths ?? 0,
    assists: self.assists ?? 0,
    spells: [self.spell1Id, self.spell2Id].sort((a, b) => a - b) as [number, number],
    primaryStyle: primary.style ?? 0,
    keystone: mainPerks[0] ?? 0,
    subStyle: sub.style ?? 0,
    perks: [...mainPerks, ...subPerks],
    laneOpponent,
    starterItems: null,
    purchases: null
  }
  return { item, fact }
}

/** SGP 列表分页拉取（一步拿到列表 + 全部单局事实），含去重与分页失效早停 */
export async function fetchSgpAll(
  getPage: (startIndex: number, count: number) => Promise<{ games: any[] }>,
  puuid: string,
  range: number,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<{ items: MatchListItem[]; facts: Map<number, MasteryGameFact> }> {
  const items: MatchListItem[] = []
  const facts = new Map<number, MasteryGameFact>()
  const seen = new Set<number>()
  const pageSize = 20
  const pages = Math.ceil(range / pageSize)
  for (let i = 0; i < pages; i++) {
    if (signal?.aborted) break
    const start = i * pageSize
    const count = Math.min(pageSize, range - start)
    let games: any[] = []
    try {
      const res = await getPage(start, count)
      games = Array.isArray(res?.games) ? res.games : []
    } catch {
      break
    }
    let fresh = 0
    for (const raw of games) {
      const gid = raw?.json?.gameId ?? raw?.gameId
      if (typeof gid !== 'number' || seen.has(gid)) continue
      seen.add(gid)
      fresh++
      const got = extractFromSgpGame(raw, puuid)
      if (got) {
        items.push(got.item)
        facts.set(got.item.gameId, got.fact)
      }
    }
    onProgress?.(Math.min(range, start + count), range)
    if (fresh === 0 || games.length < count) break
    await sleep(FETCH_INTERVAL_MS)
  }
  return { items, facts }
}

/** 对已有事实逐局补时间线（初装/核心装/单杀），失败不致命 */
export async function fetchTimelinesInto(
  facts: MasteryGameFact[],
  getTimeline: (gameId: number) => Promise<GameTimeline>,
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<number> {
  let failures = 0
  let done = 0
  for (const fact of facts) {
    if (signal?.aborted) break
    try {
      const tl = await getTimeline(fact.gameId)
      applyTimeline(fact, tl)
    } catch {
      failures++
    }
    done++
    onProgress?.(done, facts.length)
    await sleep(FETCH_INTERVAL_MS)
  }
  return failures
}

// ==================================================================
// ================ 第三步：时间线 → 初装 / 单杀等级 =================
// ==================================================================

/**
 * 归一化时间线：兼容 SGP 完整详情（Riot 形状，可能包 json 一层）与 LCU 阉割版。
 * 两者 frames/events/participantFrames 字段同构，仅外层包装不同。
 */
export function normalizeTimeline(raw: any): GameTimeline | null {
  const frames = raw?.frames ?? raw?.json?.frames ?? raw?.data?.frames ?? raw?.info?.frames
  if (!Array.isArray(frames)) return null
  return { frames } as GameTimeline
}

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
  const purchases: { itemId: number; ts: number }[] = []
  let firstSoloKill: { level: number; timeMs: number } | null = null
  let firstSoloDeath: { level: number; timeMs: number } | null = null
  const opp = fact.laneOpponent

  for (const frame of timeline.frames ?? []) {
    for (const ev of (frame.events ?? []) as any[]) {
      if (!ev || typeof ev !== 'object') continue
      if (
        ev.type === 'ITEM_PURCHASED' &&
        ev.participantId === fact.selfPid &&
        typeof ev.itemId === 'number'
      ) {
        purchases.push({ itemId: ev.itemId, ts: ev.timestamp ?? 0 })
        if ((ev.timestamp ?? 0) <= STARTER_WINDOW_MS) {
          starters.push(ev.itemId)
        }
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
  fact.purchases = purchases.sort((a, b) => a.ts - b.ts)
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

export interface AggregateOptions {
  /** 装备总价查询（渲染端注入官方资源）；返回 null 表示未知 */
  itemGoldOf?: (id: number) => number | null
}

export function aggregate(facts: MasteryGameFact[], opts: AggregateOptions = {}): MasteryAggregate {
  const spellMap = new Map<string, ComboStat>()
  const runeMap = new Map<string, RunePageStat>()
  const starterMap = new Map<string, ComboStat>()
  const coreMap = new Map<string, ComboStat>()
  const bootsMap = new Map<string, ComboStat>()
  let coreSampleGames = 0
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

    if (f.purchases !== null && opts.itemGoldOf) {
      coreSampleGames++
      const cores: number[] = []
      let boot: number | null = null
      for (const pu of f.purchases) {
        if (boot === null && BOOTS_IDS.has(pu.itemId)) {
          boot = pu.itemId
          continue
        }
        if (cores.length < 3 && !BOOTS_IDS.has(pu.itemId)) {
          const gold = opts.itemGoldOf(pu.itemId)
          if (gold !== null && gold >= CORE_ITEM_GOLD) {
            cores.push(pu.itemId)
          }
        }
      }
      if (cores.length > 0) pushCombo(coreMap, cores, f.win)
      if (boot !== null) pushCombo(bootsMap, [boot], f.win)
    }

    if (f.firstSoloKill !== undefined) {
      soloSampleGames++
      if (f.firstSoloKill) soloKills.push(f.firstSoloKill)
      if (f.firstSoloDeath) soloDeaths.push(f.firstSoloDeath)
    }
  }

  const avg = (xs: number[]) =>
    xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10

  const bucketize = (points: { level: number }[]): number[] => {
    const counts = LEVEL_BUCKETS.map(() => 0)
    for (const pt of points) counts[levelBucketIndex(pt.level)]++
    return counts
  }

  const byGames = <T extends { games: number }>(a: T, b: T) => b.games - a.games

  return {
    totalGames: facts.length,
    wins,
    spellCombos: [...spellMap.values()].sort(byGames),
    runePages: [...runeMap.values()].sort(byGames),
    starterCombos: [...starterMap.values()].sort(byGames),
    coreCombos: [...coreMap.values()].sort(byGames),
    bootsStats: [...bootsMap.values()].sort(byGames),
    coreSampleGames,
    starterSampleGames,
    firstSoloKill: {
      games: soloKills.length,
      avgLevel: avg(soloKills.map((x) => x.level)),
      avgTimeMs: soloKills.length
        ? Math.round(soloKills.reduce((a, b) => a + b.timeMs, 0) / soloKills.length)
        : null,
      levelBuckets: bucketize(soloKills)
    },
    firstSoloDeath: {
      games: soloDeaths.length,
      avgLevel: avg(soloDeaths.map((x) => x.level)),
      avgTimeMs: soloDeaths.length
        ? Math.round(soloDeaths.reduce((a, b) => a + b.timeMs, 0) / soloDeaths.length)
        : null,
      levelBuckets: bucketize(soloDeaths)
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
  const seen = new Set<number>()
  const pageSize = 20
  const pages = Math.ceil(range / pageSize)
  for (let i = 0; i < pages; i++) {
    if (signal?.aborted) break
    const beg = i * pageSize
    const end = Math.min(range - 1, beg + pageSize - 1)
    const res = await api.getMatchHistory(puuid, beg, end)
    const games = res.games?.games ?? []
    // 按 gameId 去重：部分客户端环境忽略分页参数（每页返回同一批），
    // 若整页无新对局说明分页失效或已到尽头，立即停止，绝不重复计数
    let fresh = 0
    for (const g of games) {
      if (seen.has(g.gameId)) continue
      seen.add(g.gameId)
      fresh++
      const it = toListItem(g)
      if (it) items.push(it)
    }
    onProgress?.(Math.min(range, end + 1), range)
    if (fresh === 0 || games.length < end - beg + 1) break
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
