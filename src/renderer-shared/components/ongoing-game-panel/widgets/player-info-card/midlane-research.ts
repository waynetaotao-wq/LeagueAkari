/**
 * [lolps] 中单研究（Midlane Research）—— 核心逻辑（自包含，可单测）
 *
 * 对局界面对敌我中单自动展示：该玩家当前英雄的
 *   ① 首次单杀等级分布（1-3 / 4-5 / 6当级 / 7-8 / 9+ 五桶，不限对手）
 *   ② 首次游走时间分布（0-5 / 5-8 / 8-11 / 11+ 分钟四桶）与去向（偏上 / 偏下 / 入侵野区）
 *
 * 数据全走 SGP：列表按「版本梯队」凑样本（当前版本 → 上一版 → 上上版，最多三层、
 * 凑满 500 封顶，不足如实）；深度分析取其中最近 DEEP_GAMES 场逐局拉时间线。
 * 首次游走用「分钟级坐标帧 + 击杀/助攻事件精确坐标」双信号，取更早者。
 */

// ==================================================================
// ============================ 可调区 ==============================
// ==================================================================

/** 样本目标（版本梯队凑满即停） */
export const TARGET_GAMES = 500
/** 版本梯队最大层数（当前版本 + 往前补两版） */
export const MAX_VERSIONS = 3
/** 列表翻页上限（20 条/页；防冷门英雄无限翻页） */
export const MAX_LIST_PAGES = 60
/** 深度分析（时间线）场次：取最近 N 场 */
export const DEEP_GAMES = 60
/** 深度请求间隔（毫秒；250 连发适度放宽防限流） */
export const FETCH_INTERVAL_MS = 60
/** 渐进式展示：每分析 N 场吐一次中间聚合 */
export const PARTIAL_EVERY = 10
/**
 * 深度分析并发上限 —— 全局共享闸门：
 * 敌我两个中单实例同时拉取时，总在途请求也不超过此数（防限流雪崩）。
 * 单实例独跑时 5 路全速（约 7-9 秒）；双实例并行时两边分享额度。
 */
export const DEEP_CONCURRENCY = 5

// 模块级信号量（跨组件实例共享）
let laneInFlight = 0
const laneWaiters: (() => void)[] = []
async function acquireLane(): Promise<void> {
  if (laneInFlight < DEEP_CONCURRENCY) {
    laneInFlight++
    return
  }
  await new Promise<void>((resolve) => laneWaiters.push(resolve))
  laneInFlight++
}
function releaseLane(): void {
  laneInFlight--
  const next = laneWaiters.shift()
  if (next) next()
}

/** 经典模式队列 */
const CLASSIC_QUEUES = new Set([420, 440, 430, 400, 490])

/** 召唤师峡谷几何（地图边长与分区参数，坐标原点左下=蓝方基地） */
export const MAP_SIZE = 14800
const MID_HALF = 1400 // 中路带：|x-y| ≤ 该值
const EDGE = 2200 // 边路 L 形走廊宽（收窄至线上实际走廊，野区让给 invade 判定）
const LANE_FAR = MAP_SIZE - EDGE
const BASE_SUM = 2600 // 基地判定：x+y < 该值（蓝）/ > 2*MAP-该值（红）

/** 对线开始时间：此前的走位不算游走 */
export const ROAM_START_MS = 90_000

/** 首次单杀等级五桶（与绝活研究同口径） */
export const LEVEL_BUCKETS = [
  { key: '1-3', label: '1-3级', min: 1, max: 3 },
  { key: '4-5', label: '4-5级', min: 4, max: 5 },
  { key: '6', label: '6级当级', min: 6, max: 6 },
  { key: '7-8', label: '7-8级', min: 7, max: 8 },
  { key: '9+', label: '9级+', min: 9, max: 99 }
] as const

/** 首次游走时间四桶（对齐先锋/小龙节奏） */
export const ROAM_TIME_BUCKETS = [
  { key: '0-5', label: '0-5分', min: 0, max: 5 * 60_000 },
  { key: '5-8', label: '5-8分', min: 5 * 60_000, max: 8 * 60_000 },
  { key: '8-11', label: '8-11分', min: 8 * 60_000, max: 11 * 60_000 },
  { key: '11+', label: '11分+', min: 11 * 60_000, max: Infinity }
] as const

// ==================================================================
// ============================ 类型 ================================
// ==================================================================

export type ZoneKind = 'base' | 'mid' | 'top' | 'bot' | 'invade'
export type RoamDir = Exclude<ZoneKind, 'base' | 'mid'>

export interface MidLiteGame {
  gameId: number
  win: boolean
  gameVersion: string
  gameCreation: number
  selfPid: number
  teamId: number
  /** 敌方中单 participantId（用于 10 分钟对线差；缺位置数据时 null） */
  enemyMidPid?: number | null
}

export interface VersionSlice {
  version: string
  games: number
  wins: number
}

export interface MidLadderResult {
  games: MidLiteGame[]
  slices: VersionSlice[]
  /** 是否因翻页上限截断（样本可能不完整） */
  truncated: boolean
}

export interface MidMapPoint {
  x: number
  y: number
  lane: 'top' | 'mid' | 'bot'
}

export interface MidDeepResult {
  deepGames: number
  firstKillGames: number
  firstKillBuckets: number[]
  roamGames: number
  roamTimeBuckets: number[]
  roamDirs: Record<RoamDir, number>
  timelineFailures: number

  // ---- v2（地图与一眼可见的统计；前 14 分钟口径）----
  /** 2–14 分钟每分钟坐标（热力图） */
  minutePositions: MidMapPoint[]
  /** 参与击杀（主杀/助攻）的位置点 */
  killPoints: MidMapPoint[]
  /** 位置点分区计数（上/中/下，用于分区权重） */
  zoneFrames: { top: number; mid: number; bot: number }
  /** 游走（进入上下路走廊，或在走廊参与击杀）：次数、方向、首次时间、成功次数 */
  roamEpisodes: number
  roamEpisodeDirs: { top: number; bot: number }
  roamFirstTimesMs: number[]
  roamSuccess: number
  /** 对线：10 分钟补刀差 / 经济差（相对敌方中单）样本和与计数 */
  laneDiffGames: number
  csDiff10Sum: number
  goldDiff10Sum: number
  goldLead10Games: number
  /** 单杀 / 被单杀（前 14 分钟）；参团（前 14 分钟） */
  soloKills: number
  soloDeaths: number
  earlyTakedowns: number
  earlyTeamKills: number
}

// ==================================================================
// ========================= 几何与工具 ==============================
// ==================================================================

export function shortVersion(v: string | undefined | null): string {
  if (!v) return ''
  return v.split('.').slice(0, 2).join('.')
}

export function levelBucketIndex(level: number): number {
  const i = LEVEL_BUCKETS.findIndex((b) => level >= b.min && level <= b.max)
  return i >= 0 ? i : LEVEL_BUCKETS.length - 1
}

export function roamTimeBucketIndex(ms: number): number {
  const i = ROAM_TIME_BUCKETS.findIndex((b) => ms >= b.min && ms < b.max)
  return i >= 0 ? i : ROAM_TIME_BUCKETS.length - 1
}

/**
 * 坐标分区（teamId 决定敌我半区）：
 * base → mid（对角线带）→ 上/下路 L 走廊 → 敌方半区野区=invade → 己方野区按对角线侧分上下。
 * 两侧基地都在对角线上，回城/泉水天然不会被误判为游走。
 */
export function classifyPoint(x: number, y: number, teamId: number): ZoneKind {
  const sum = x + y
  if (sum < BASE_SUM || sum > 2 * MAP_SIZE - BASE_SUM) return 'base'
  if (Math.abs(x - y) <= MID_HALF) return 'mid'
  if (x < EDGE || y > LANE_FAR) return 'top'
  if (y < EDGE || x > LANE_FAR) return 'bot'
  const enemyHalf = teamId === 100 ? sum > MAP_SIZE : sum < MAP_SIZE
  if (enemyHalf) return 'invade'
  return y > x ? 'top' : 'bot'
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function normalizeTimeline(raw: any): { frames: any[] } | null {
  const frames = raw?.frames ?? raw?.json?.frames ?? raw?.data?.frames ?? raw?.info?.frames
  if (!Array.isArray(frames)) return null
  return { frames }
}

// ==================================================================
// ================== 第一步：SGP 版本梯队凑样本 =====================
// ==================================================================

/** SGP 列表元素 → 该英雄的轻量对局；非目标（模式/英雄不符）返回 null */
export function extractMidLite(raw: any, puuid: string, championId: number): MidLiteGame | null {
  const g = raw?.json ?? raw
  if (!g || g.gameMode !== 'CLASSIC') return null
  if (typeof g.queueId !== 'number' || !CLASSIC_QUEUES.has(g.queueId)) return null
  const parts: any[] = Array.isArray(g.participants) ? g.participants : []
  const self = parts.find((p) => p?.puuid === puuid)
  if (!self || self.championId !== championId) return null
  const enemyMid = parts.find(
    (p) => p && p.teamId !== self.teamId && String(p.teamPosition ?? '').toUpperCase() === 'MIDDLE'
  )
  return {
    gameId: g.gameId,
    win: self.win === true,
    gameVersion: shortVersion(g.gameVersion),
    gameCreation: g.gameCreation ?? g.gameStartTimestamp ?? 0,
    selfPid: self.participantId,
    teamId: self.teamId,
    enemyMidPid: typeof enemyMid?.participantId === 'number' ? enemyMid.participantId : null
  }
}

/**
 * 版本梯队收集：时间倒序翻列表，只收目标英雄；
 * 版本集 = 遇到的前 MAX_VERSIONS 个不同版本（当前 + 往前两版），
 * 更旧版本一旦出现立即停；累计满 TARGET_GAMES 或翻页到上限也停。
 */
export async function collectVersionLadder(
  getPage: (startIndex: number, count: number) => Promise<{ games: any[] }>,
  puuid: string,
  championId: number,
  opts?: { target?: number; maxVersions?: number; maxPages?: number },
  onProgress?: (collected: number, target: number) => void,
  signal?: AbortSignal
): Promise<MidLadderResult> {
  const target = opts?.target ?? TARGET_GAMES
  const maxVersions = opts?.maxVersions ?? MAX_VERSIONS
  const maxPages = opts?.maxPages ?? MAX_LIST_PAGES

  const games: MidLiteGame[] = []
  const seen = new Set<number>()
  const versionOrder: string[] = []
  const sliceMap = new Map<string, VersionSlice>()
  let truncated = false
  const pageSize = 20

  outer: for (let i = 0; i < maxPages; i++) {
    if (signal?.aborted) break
    let page: any[] = []
    try {
      const res = await getPage(i * pageSize, pageSize)
      page = Array.isArray(res?.games) ? res.games : []
    } catch {
      break
    }
    let fresh = 0
    for (const raw of page) {
      const g = raw?.json ?? raw
      const gid = g?.gameId
      if (typeof gid !== 'number' || seen.has(gid)) continue
      seen.add(gid)
      fresh++

      // 版本层控制看"所有对局"的版本（时间倒序，版本单调向旧）
      const ver = shortVersion(g?.gameVersion)
      if (ver) {
        if (!versionOrder.includes(ver)) {
          if (versionOrder.length >= maxVersions) break outer // 进入更旧版本层，停
          versionOrder.push(ver)
        }
      }

      const lite = extractMidLite(raw, puuid, championId)
      if (lite) {
        games.push(lite)
        let s = sliceMap.get(lite.gameVersion)
        if (!s) {
          s = { version: lite.gameVersion, games: 0, wins: 0 }
          sliceMap.set(lite.gameVersion, s)
        }
        s.games++
        if (lite.win) s.wins++
        if (games.length >= target) break outer
      }
    }
    onProgress?.(games.length, target)
    if (fresh === 0 || page.length < pageSize) break
    await sleep(FETCH_INTERVAL_MS)
    if (i === maxPages - 1) truncated = true
  }

  const slices = versionOrder
    .map((v) => sliceMap.get(v))
    .filter((x): x is VersionSlice => !!x)
  return { games, slices, truncated }
}

// ==================================================================
// ================== 第二步：深度分析（时间线） =====================
// ==================================================================

function levelAt(frames: any[], pid: number, timestamp: number): number {
  let level = 1
  for (const frame of frames) {
    if (frame.timestamp > timestamp) break
    const pf = frame.participantFrames?.[String(pid)]
    if (pf && typeof pf.level === 'number') level = pf.level
  }
  return level
}

export const EARLY_MS = 14 * 60_000
const LANE_DIFF_MINUTE = 10

/** 官方同款三分区（任何坐标归到 top/mid/bot 之一，用于热力图与分区权重） */
export function classifyMapZone3(x: number, y: number): 'top' | 'mid' | 'bot' {
  if (x < 5000 && y > 9000) return 'top'
  if (x > 9000 && y < 5000) return 'bot'
  if (Math.abs(y - x) <= 3500) return 'mid'
  return y > x ? 'top' : 'bot'
}

/**
 * 严格走廊：只有真正身处上/下路走廊才算游走。
 * 上路 = 左边缘条带（x<3000 且 y>5000）∪ 上边缘条带（y>12000 且 x<11000）；
 * 下路 = 下边缘条带（y<3000 且 x>4000）∪ 右边缘条带（x>12000 且 y<10500）。
 * 龙坑 (9866,4414)、男爵坑 (5007,10471)、河道草丛均不在其中——去插眼 / 帮野 / 打龙不算"游走去向"。
 */
export function classifyLaneCorridor(x: number, y: number): 'top' | 'bot' | null {
  if ((x < 3000 && y > 5000) || (y > 12000 && x < 11000)) return 'top'
  if ((y < 3000 && x > 4000) || (x > 12000 && y < 10500)) return 'bot'
  return null
}

export interface MidOneTimelineV2 {
  minutePositions: MidMapPoint[]
  killPoints: MidMapPoint[]
  zoneFrames: { top: number; mid: number; bot: number }
  roamEpisodes: Array<{ startMs: number; dir: 'top' | 'bot'; success: boolean }>
  laneDiff10: { cs: number; gold: number } | null
  soloKills: number
  soloDeaths: number
  earlyTakedowns: number
  earlyTeamKills: number
}

/**
 * 单局 v2：地图点位 + 游走片段（从严）+ 10 分钟对线差 + 单杀/被单杀 + 前期参团。
 * 游走片段：连续处于同一走廊的分钟帧合并为一段；走廊内参与的击杀若不在任何帧段 ±60s 内，
 * 单独成段；成功 = 段内（±90s）有本人参与的击杀。
 */
export function analyzeOneTimelineV2(
  tl: { frames: any[] },
  selfPid: number,
  teamId: number,
  enemyMidPid?: number | null
): MidOneTimelineV2 {
  const frames = tl.frames ?? []
  const minutePositions: MidMapPoint[] = []
  const killPoints: MidMapPoint[] = []
  const zoneFrames = { top: 0, mid: 0, bot: 0 }
  const corridorFrames: Array<{ ms: number; dir: 'top' | 'bot' }> = []
  const corridorKills: Array<{ ms: number; dir: 'top' | 'bot' }> = []
  let laneDiff10: { cs: number; gold: number } | null = null
  let soloKills = 0
  let soloDeaths = 0
  let earlyTakedowns = 0
  let earlyTeamKills = 0

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const ts = frame.timestamp ?? i * 60_000
    const minute = Math.round(ts / 60_000)
    if (minute >= 2 && minute <= 14) {
      const pf = frame.participantFrames?.[String(selfPid)]
      const pos = pf?.position
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        const lane = classifyMapZone3(pos.x, pos.y)
        minutePositions.push({ x: pos.x, y: pos.y, lane })
        zoneFrames[lane]++
        const corridor = classifyLaneCorridor(pos.x, pos.y)
        if (corridor) corridorFrames.push({ ms: ts, dir: corridor })
      }
    }
    if (minute === LANE_DIFF_MINUTE && enemyMidPid != null) {
      const me = frame.participantFrames?.[String(selfPid)]
      const op = frame.participantFrames?.[String(enemyMidPid)]
      if (me && op) {
        const cs = (n: any) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)
        laneDiff10 = {
          cs: cs(me.minionsKilled) + cs(me.jungleMinionsKilled) - cs(op.minionsKilled) - cs(op.jungleMinionsKilled),
          gold: cs(me.totalGold) - cs(op.totalGold)
        }
      }
    }
    for (const ev of (frame.events ?? []) as any[]) {
      if (!ev || ev.type !== 'CHAMPION_KILL') continue
      const evTs = ev.timestamp ?? 0
      if (evTs > EARLY_MS) continue
      const assists: number[] = Array.isArray(ev.assistingParticipantIds) ? ev.assistingParticipantIds : []
      const involved = ev.killerId === selfPid || assists.includes(selfPid)
      const pos = ev.position
      const hasPos = pos && typeof pos.x === 'number' && typeof pos.y === 'number'
      // 队伍击杀：击杀者属于本队（用 pid 段判断：1–5 为 100 队，6–10 为 200 队）
      const killerTeam = ev.killerId >= 1 && ev.killerId <= 5 ? 100 : ev.killerId >= 6 ? 200 : 0
      if (killerTeam === teamId) earlyTeamKills++
      if (involved) {
        earlyTakedowns++
        if (hasPos) {
          killPoints.push({ x: pos.x, y: pos.y, lane: classifyMapZone3(pos.x, pos.y) })
          const corridor = classifyLaneCorridor(pos.x, pos.y)
          if (corridor && evTs >= ROAM_START_MS) corridorKills.push({ ms: evTs, dir: corridor })
        }
        if (ev.killerId === selfPid && assists.length === 0) soloKills++
      }
      if (ev.victimId === selfPid && assists.length === 0 && ev.killerId >= 1) {
        // 被单杀：只算在中路带内被单杀（对线失误），排除被抓与游走被反
        if (hasPos && classifyMapZone3(pos.x, pos.y) === 'mid') soloDeaths++
      }
    }
  }

  // 走廊帧合并为片段
  const episodes: Array<{ startMs: number; endMs: number; dir: 'top' | 'bot'; success: boolean }> = []
  for (const f of corridorFrames) {
    if (f.ms < ROAM_START_MS) continue
    const last = episodes[episodes.length - 1]
    if (last && last.dir === f.dir && f.ms - last.endMs <= 60_000) last.endMs = f.ms
    else episodes.push({ startMs: f.ms, endMs: f.ms, dir: f.dir, success: false })
  }
  for (const k of corridorKills) {
    const hit = episodes.find((e) => e.dir === k.dir && k.ms >= e.startMs - 90_000 && k.ms <= e.endMs + 90_000)
    if (hit) hit.success = true
    else episodes.push({ startMs: k.ms, endMs: k.ms, dir: k.dir, success: true })
  }
  episodes.sort((a, b) => a.startMs - b.startMs)

  return {
    minutePositions,
    killPoints,
    zoneFrames,
    roamEpisodes: episodes.map((e) => ({ startMs: e.startMs, dir: e.dir, success: e.success })),
    laneDiff10,
    soloKills,
    soloDeaths,
    earlyTakedowns,
    earlyTeamKills
  }
}

/** 单局：首次单杀（不限对手）等级 + 首次游走（帧/事件双信号取早）时间与方向 */
export function analyzeOneTimeline(
  tl: { frames: any[] },
  selfPid: number,
  teamId: number
): {
  firstSoloKill: { level: number } | null
  firstRoam: { timeMs: number; dir: RoamDir } | null
} {
  const frames = tl.frames ?? []
  let firstSoloKill: { level: number } | null = null
  let roamByFrame: { timeMs: number; dir: RoamDir } | null = null
  let roamByEvent: { timeMs: number; dir: RoamDir } | null = null

  for (const frame of frames) {
    // 帧信号：分钟级坐标快照
    if (!roamByFrame && frame.timestamp >= ROAM_START_MS) {
      const pf = frame.participantFrames?.[String(selfPid)]
      const pos = pf?.position
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        const zone = classifyPoint(pos.x, pos.y, teamId)
        if (zone !== 'mid' && zone !== 'base') {
          roamByFrame = { timeMs: frame.timestamp, dir: zone }
        }
      }
    }

    for (const ev of (frame.events ?? []) as any[]) {
      if (!ev || ev.type !== 'CHAMPION_KILL') continue
      const ts = ev.timestamp ?? 0
      // 首次单杀（不限对手）
      if (
        !firstSoloKill &&
        ev.killerId === selfPid &&
        (ev.assistingParticipantIds?.length ?? 0) === 0
      ) {
        firstSoloKill = { level: levelAt(frames, selfPid, ts) }
      }
      // 事件信号：他参与击杀（主杀或助攻）且位置在中路带之外
      if (!roamByEvent && ts >= ROAM_START_MS) {
        const involved =
          ev.killerId === selfPid ||
          (Array.isArray(ev.assistingParticipantIds) &&
            ev.assistingParticipantIds.includes(selfPid))
        const pos = ev.position
        if (involved && pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
          const zone = classifyPoint(pos.x, pos.y, teamId)
          if (zone !== 'mid' && zone !== 'base') {
            roamByEvent = { timeMs: ts, dir: zone }
          }
        }
      }
    }
  }

  let firstRoam: { timeMs: number; dir: RoamDir } | null = null
  if (roamByFrame && roamByEvent) {
    firstRoam = roamByEvent.timeMs <= roamByFrame.timeMs ? roamByEvent : roamByFrame
  } else {
    firstRoam = roamByEvent ?? roamByFrame
  }
  return { firstSoloKill, firstRoam }
}

/** 对最近 DEEP_GAMES 场逐局补时间线并聚合两大指标 */
export function emptyDeepResult(): MidDeepResult {
  return {
    deepGames: 0,
    firstKillGames: 0,
    firstKillBuckets: LEVEL_BUCKETS.map(() => 0),
    roamGames: 0,
    roamTimeBuckets: ROAM_TIME_BUCKETS.map(() => 0),
    roamDirs: { top: 0, bot: 0, invade: 0 },
    timelineFailures: 0,
    minutePositions: [],
    killPoints: [],
    zoneFrames: { top: 0, mid: 0, bot: 0 },
    roamEpisodes: 0,
    roamEpisodeDirs: { top: 0, bot: 0 },
    roamFirstTimesMs: [],
    roamSuccess: 0,
    laneDiffGames: 0,
    csDiff10Sum: 0,
    goldDiff10Sum: 0,
    goldLead10Games: 0,
    soloKills: 0,
    soloDeaths: 0,
    earlyTakedowns: 0,
    earlyTeamKills: 0
  }
}

export async function analyzeDeep(
  games: MidLiteGame[],
  getTimeline: (gameId: number) => Promise<any>,
  opts?: { deepGames?: number; onPartial?: (partial: MidDeepResult) => void },
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal
): Promise<MidDeepResult> {
  const deep = [...games]
    .sort((a, b) => b.gameCreation - a.gameCreation)
    .slice(0, opts?.deepGames ?? DEEP_GAMES)

  const firstKillBuckets = LEVEL_BUCKETS.map(() => 0)
  const roamTimeBuckets = ROAM_TIME_BUCKETS.map(() => 0)
  const roamDirs: Record<RoamDir, number> = { top: 0, bot: 0, invade: 0 }
  let firstKillGames = 0
  let roamGames = 0
  let timelineFailures = 0
  let done = 0
  // v2 聚合
  const minutePositions: MidMapPoint[] = []
  const killPoints: MidMapPoint[] = []
  const zoneFrames = { top: 0, mid: 0, bot: 0 }
  let roamEpisodes = 0
  const roamEpisodeDirs = { top: 0, bot: 0 }
  const roamFirstTimesMs: number[] = []
  let roamSuccess = 0
  let laneDiffGames = 0
  let csDiff10Sum = 0
  let goldDiff10Sum = 0
  let goldLead10Games = 0
  let soloKills = 0
  let soloDeaths = 0
  let earlyTakedowns = 0
  let earlyTeamKills = 0

  const snapshot = (): MidDeepResult => ({
    deepGames: done,
    firstKillGames,
    firstKillBuckets: [...firstKillBuckets],
    roamGames,
    roamTimeBuckets: [...roamTimeBuckets],
    roamDirs: { ...roamDirs },
    timelineFailures,
    minutePositions: [...minutePositions],
    killPoints: [...killPoints],
    zoneFrames: { ...zoneFrames },
    roamEpisodes,
    roamEpisodeDirs: { ...roamEpisodeDirs },
    roamFirstTimesMs: [...roamFirstTimesMs],
    roamSuccess,
    laneDiffGames,
    csDiff10Sum,
    goldDiff10Sum,
    goldLead10Games,
    soloKills,
    soloDeaths,
    earlyTakedowns,
    earlyTeamKills
  })

  // 并发工作池：网络等待相互重叠（js 单线程，计数与快照天然安全）；
  // 软熔断：失败占比异常（服务端在拒绝）时提前收手，避免限流雪崩
  let cursor = 0
  const worker = async () => {
    while (true) {
      if (signal?.aborted) return
      if (done > 20 && timelineFailures > done / 2) return
      const idx = cursor++
      if (idx >= deep.length) return
      const g = deep[idx]
      await acquireLane()
      try {
        const raw = await getTimeline(g.gameId)
        const tl = normalizeTimeline(raw)
        if (tl) {
          const one = analyzeOneTimeline(tl, g.selfPid, g.teamId)
          if (one.firstSoloKill) {
            firstKillGames++
            firstKillBuckets[levelBucketIndex(one.firstSoloKill.level)]++
          }
          if (one.firstRoam) {
            roamGames++
            roamTimeBuckets[roamTimeBucketIndex(one.firstRoam.timeMs)]++
            roamDirs[one.firstRoam.dir]++
          }
          const v2 = analyzeOneTimelineV2(tl, g.selfPid, g.teamId, g.enemyMidPid)
          minutePositions.push(...v2.minutePositions)
          killPoints.push(...v2.killPoints)
          zoneFrames.top += v2.zoneFrames.top
          zoneFrames.mid += v2.zoneFrames.mid
          zoneFrames.bot += v2.zoneFrames.bot
          roamEpisodes += v2.roamEpisodes.length
          for (const e of v2.roamEpisodes) {
            roamEpisodeDirs[e.dir]++
            if (e.success) roamSuccess++
          }
          if (v2.roamEpisodes.length) roamFirstTimesMs.push(v2.roamEpisodes[0].startMs)
          if (v2.laneDiff10) {
            laneDiffGames++
            csDiff10Sum += v2.laneDiff10.cs
            goldDiff10Sum += v2.laneDiff10.gold
            if (v2.laneDiff10.gold > 0) goldLead10Games++
          }
          soloKills += v2.soloKills
          soloDeaths += v2.soloDeaths
          earlyTakedowns += v2.earlyTakedowns
          earlyTeamKills += v2.earlyTeamKills
        } else {
          timelineFailures++
        }
      } catch {
        timelineFailures++
      } finally {
        releaseLane()
      }
      done++
      onProgress?.(done, deep.length)
      if (opts?.onPartial && done % PARTIAL_EVERY === 0 && done < deep.length) {
        opts.onPartial(snapshot())
      }
      await sleep(FETCH_INTERVAL_MS)
    }
  }
  const lanes = Math.max(1, Math.min(DEEP_CONCURRENCY, deep.length))
  await Promise.all(Array.from({ length: lanes }, () => worker()))

  return snapshot()
}
