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
export const DEEP_GAMES = 150
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

export interface MidDeepResult {
  deepGames: number
  firstKillGames: number
  firstKillBuckets: number[]
  roamGames: number
  roamTimeBuckets: number[]
  roamDirs: Record<RoamDir, number>
  timelineFailures: number
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
  return {
    gameId: g.gameId,
    win: self.win === true,
    gameVersion: shortVersion(g.gameVersion),
    gameCreation: g.gameCreation ?? g.gameStartTimestamp ?? 0,
    selfPid: self.participantId,
    teamId: self.teamId
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
    timelineFailures: 0
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

  const snapshot = (): MidDeepResult => ({
    deepGames: done,
    firstKillGames,
    firstKillBuckets: [...firstKillBuckets],
    roamGames,
    roamTimeBuckets: [...roamTimeBuckets],
    roamDirs: { ...roamDirs },
    timelineFailures
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
