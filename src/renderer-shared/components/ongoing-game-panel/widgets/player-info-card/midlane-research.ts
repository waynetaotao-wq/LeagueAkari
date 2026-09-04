/**
 * [lolps] 中单研究（Midlane Research）—— 核心逻辑（自包含，可单测）
 *
 * 对局界面对敌我中单自动展示：该玩家当前英雄的
 *   ① 前 14 分钟首次单杀等级分布（1-3 / 4-5 / 6当级 / 7-8 / 9+，不限对手）
 *   ② 前 14 分钟首次游走时间分布与去向（上 / 下路）
 *
 * 数据全走 SGP：列表按最近玩过的三个版本凑本人该英雄的中路完整 5v5 样本；
 * 最多 500 场，深度分析取其中最近 DEEP_GAMES 场。失败不计入统计分母。
 * 游走以本人坐标帧为证；击杀事件须有附近本人坐标佐证，不能用远程助攻推定到场。
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
}
function releaseLane(): void {
  const next = laneWaiters.shift()
  if (next) next()
  else laneInFlight--
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
  gameDuration: number
  selfPid: number
  teamId: number
  /** 从摘要参与者派生，不假定 participantId 的数值区间代表队伍 */
  participantTeams: Record<number, number>
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
  /** 有效时间线样本；所有场均指标只以此为分母 */
  deepGames: number
  /** 完成请求的时间线数量（有效 + 失败） */
  attemptedGames: number
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
  if (
    !Array.isArray(frames) ||
    frames.length === 0 ||
    frames.some(
      (f) => !f || !isFiniteNumber(f.timestamp) || f.timestamp < 0 || !Array.isArray(f.events)
    )
  )
    return null
  return { frames: [...frames].sort((a, b) => a.timestamp - b.timestamp) }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function hasPosition(value: any): value is { x: number; y: number } {
  return isFiniteNumber(value?.x) && isFiniteNumber(value?.y) && value.x >= 0 && value.y >= 0
}

// ==================================================================
// ================== 第一步：SGP 版本梯队凑样本 =====================
// ==================================================================

/** SGP 列表元素 → 该英雄的轻量对局；非目标（模式/英雄不符）返回 null */
export function extractMidLite(raw: any, puuid: string, championId: number): MidLiteGame | null {
  const g = raw?.json ?? raw
  if (!g || g.gameMode !== 'CLASSIC' || g.mapId !== 11) return null
  if (typeof g.queueId !== 'number' || !CLASSIC_QUEUES.has(g.queueId)) return null
  if (
    !isFiniteNumber(g.gameId) ||
    g.gameId <= 0 ||
    !isFiniteNumber(g.gameDuration) ||
    g.gameDuration < 300
  )
    return null
  if (String(g.endOfGameResult ?? '').startsWith('Abort_')) return null
  const parts: any[] = Array.isArray(g.participants) ? g.participants : []
  if (
    parts.length !== 10 ||
    parts.some(
      (p) =>
        !p ||
        !Number.isInteger(p.participantId) ||
        p.participantId <= 0 ||
        p.gameEndedInEarlySurrender === true
    ) ||
    new Set(parts.map((p) => p.participantId)).size !== 10 ||
    parts.filter((p) => p.teamId === 100).length !== 5 ||
    parts.filter((p) => p.teamId === 200).length !== 5
  )
    return null
  const self = parts.find((p) => p?.puuid === puuid)
  if (
    !self ||
    self.championId !== championId ||
    String(self.teamPosition ?? '').toUpperCase() !== 'MIDDLE'
  )
    return null
  const enemyMids = parts.filter(
    (p) => p.teamId !== self.teamId && String(p.teamPosition ?? '').toUpperCase() === 'MIDDLE'
  )
  const creation = g.gameCreation ?? g.gameStartTimestamp
  if (!isFiniteNumber(creation) || creation <= 0) return null
  return {
    gameId: g.gameId,
    win: self.win === true,
    gameVersion: shortVersion(g.gameVersion),
    gameCreation: creation,
    gameDuration: g.gameDuration,
    selfPid: self.participantId,
    teamId: self.teamId,
    participantTeams: Object.fromEntries(parts.map((p) => [p.participantId, p.teamId])),
    enemyMidPid: enemyMids.length === 1 ? enemyMids[0].participantId : null
  }
}

/**
 * 版本梯队收集：时间倒序翻列表，只收目标英雄；
 * 版本集 = 该玩家最近玩过的前 MAX_VERSIONS 个不同版本，
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
    signal?.throwIfAborted()
    const res = await getPage(i * pageSize, pageSize)
    signal?.throwIfAborted()
    if (!Array.isArray(res?.games)) throw new Error('中单战绩列表格式异常')
    const page: any[] = res.games
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

  const slices = versionOrder.map((v) => sliceMap.get(v)).filter((x): x is VersionSlice => !!x)
  signal?.throwIfAborted()
  return { games, slices, truncated }
}

// ==================================================================
// ================== 第二步：深度分析（时间线） =====================
// ==================================================================

function levelAt(frames: any[], pid: number, timestamp: number, killEvent: any): number | null {
  let level: number | null = null
  let knownAt = -1
  for (const frame of frames) {
    const pf = frame.participantFrames?.[String(pid)]
    if (
      frame.timestamp < timestamp &&
      frame.timestamp >= knownAt &&
      isFiniteNumber(pf?.level) &&
      pf.level >= 1
    ) {
      level = pf.level
      knownAt = frame.timestamp
    }
  }
  // 同一时间戳内保留事件顺序：击杀之后获得经验的升级不能倒算到这次击杀。
  const events = frames.flatMap((f) => f.events ?? []).sort((a, b) => a.timestamp - b.timestamp)
  for (const ev of events) {
    if (ev === killEvent) break
    if (
      ev?.type === 'LEVEL_UP' &&
      ev.participantId === pid &&
      isFiniteNumber(ev.timestamp) &&
      ev.timestamp <= timestamp &&
      ev.timestamp >= knownAt &&
      isFiniteNumber(ev.level) &&
      ev.level >= 1
    ) {
      level = ev.level
      knownAt = ev.timestamp
    }
  }
  return level
}

export const EARLY_MS = 14 * 60_000
const LANE_DIFF_MS = 10 * 60_000
/** 允许分钟快照的毫秒漂移，不把缺失整帧的长间隔合并。 */
const MAX_FRAME_GAP_MS = 90_000
const EVENT_POSITION_WINDOW_MS = 60_000
const EVENT_POSITION_DISTANCE = 3000

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
 * 单局前 14 分钟：连续本人坐标帧组成游走片段；击杀位置不是参与者坐标，
 * 只有最近一分钟内的本人快照在同走廊且相距不超过 3000 地图单位时才作游走佐证。
 */
export function analyzeOneTimelineV2(
  tl: { frames: any[] },
  selfPid: number,
  teamId: number,
  enemyMidPid?: number | null,
  participantTeams: Record<number, number> = {}
): MidOneTimelineV2 {
  const frames = [...(tl.frames ?? [])].sort((a, b) => a.timestamp - b.timestamp)
  const minutePositions: MidMapPoint[] = []
  const killPoints: MidMapPoint[] = []
  const zoneFrames = { top: 0, mid: 0, bot: 0 }
  const corridorFrames: Array<{ ms: number; dir: 'top' | 'bot'; index: number }> = []
  const corridorKills: Array<{ ms: number; dir: 'top' | 'bot' }> = []
  const selfFrames = frames.flatMap((frame) => {
    const pf = frame.participantFrames?.[String(selfPid)]
    if (
      !isFiniteNumber(frame.timestamp) ||
      frame.timestamp < 0 ||
      frame.timestamp > EARLY_MS ||
      !hasPosition(pf?.position)
    )
      return []
    return [
      {
        ms: frame.timestamp,
        pos: pf.position,
        usable:
          !(isFiniteNumber(pf.championStats?.health) && pf.championStats.health <= 0) &&
          classifyPoint(pf.position.x, pf.position.y, teamId) !== 'base'
      }
    ]
  })
  const hasNearbySelf = (ms: number, pos: { x: number; y: number }, dir: 'top' | 'bot') => {
    const closestDelta = Math.min(...selfFrames.map((f) => Math.abs(f.ms - ms)))
    return (
      closestDelta <= EVENT_POSITION_WINDOW_MS &&
      selfFrames.some(
        (f) =>
          Math.abs(f.ms - ms) === closestDelta &&
          f.usable &&
          classifyLaneCorridor(f.pos.x, f.pos.y) === dir &&
          Math.hypot(f.pos.x - pos.x, f.pos.y - pos.y) <= EVENT_POSITION_DISTANCE
      )
    )
  }
  let laneDiff10: { cs: number; gold: number } | null = null
  let laneDiffDelta = Infinity
  let soloKills = 0
  let soloDeaths = 0
  let earlyTakedowns = 0
  let earlyTeamKills = 0

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i]
    const ts = frame.timestamp
    if (!isFiniteNumber(ts)) continue
    const me = frame.participantFrames?.[String(selfPid)]
    const pos = me?.position
    const usable =
      hasPosition(pos) &&
      !(isFiniteNumber(me.championStats?.health) && me.championStats.health <= 0) &&
      classifyPoint(pos.x, pos.y, teamId) !== 'base'
    if (usable && ts >= 2 * 60_000 && ts <= EARLY_MS) {
      const lane = classifyMapZone3(pos.x, pos.y)
      minutePositions.push({ x: pos.x, y: pos.y, lane })
      zoneFrames[lane]++
    }
    if (usable && ts >= ROAM_START_MS && ts <= EARLY_MS) {
      const corridor = classifyLaneCorridor(pos.x, pos.y)
      if (corridor) corridorFrames.push({ ms: ts, dir: corridor, index: i })
    }
    // 仅接受 10:00 前后 5 秒的最近快照；不能把较早结束的比赛末帧凑作 10 分钟。
    const delta = Math.abs(ts - LANE_DIFF_MS)
    if (delta <= 5_000 && delta < laneDiffDelta && enemyMidPid != null) {
      const op = frame.participantFrames?.[String(enemyMidPid)]
      if (
        me &&
        op &&
        [
          me.minionsKilled,
          me.jungleMinionsKilled,
          me.totalGold,
          op.minionsKilled,
          op.jungleMinionsKilled,
          op.totalGold
        ].every(isFiniteNumber)
      ) {
        laneDiff10 = {
          cs: me.minionsKilled + me.jungleMinionsKilled - op.minionsKilled - op.jungleMinionsKilled,
          gold: me.totalGold - op.totalGold
        }
        laneDiffDelta = delta
      }
    }
    for (const ev of (frame.events ?? []) as any[]) {
      if (
        !ev ||
        ev.type !== 'CHAMPION_KILL' ||
        !isFiniteNumber(ev.timestamp) ||
        ev.timestamp < 0 ||
        ev.timestamp > EARLY_MS
      )
        continue
      const evTs = ev.timestamp
      const assistsKnown = Array.isArray(ev.assistingParticipantIds)
      const assists: number[] = assistsKnown ? ev.assistingParticipantIds : []
      const involved = ev.killerId === selfPid || assists.includes(selfPid)
      const eventPos = ev.position
      if (participantTeams[ev.killerId] === teamId) earlyTeamKills++
      if (involved) {
        earlyTakedowns++
        if (hasPosition(eventPos)) {
          // 参与点只表示击杀事件发生地，可能包含远程支援。
          killPoints.push({
            x: eventPos.x,
            y: eventPos.y,
            lane: classifyMapZone3(eventPos.x, eventPos.y)
          })
          const corridor = classifyLaneCorridor(eventPos.x, eventPos.y)
          if (corridor && evTs >= ROAM_START_MS && hasNearbySelf(evTs, eventPos, corridor)) {
            corridorKills.push({ ms: evTs, dir: corridor })
          }
        }
        if (ev.killerId === selfPid && assistsKnown && assists.length === 0) soloKills++
      }
      if (ev.victimId === selfPid && assistsKnown && assists.length === 0 && ev.killerId >= 1) {
        if (hasPosition(eventPos) && classifyPoint(eventPos.x, eventPos.y, teamId) === 'mid')
          soloDeaths++
      }
    }
  }

  const episodes: Array<{
    startMs: number
    endMs: number
    lastFrameIndex: number
    dir: 'top' | 'bot'
    success: boolean
  }> = []
  for (const f of corridorFrames) {
    const last = episodes[episodes.length - 1]
    if (
      last &&
      last.dir === f.dir &&
      last.lastFrameIndex === f.index - 1 &&
      f.ms - last.endMs <= MAX_FRAME_GAP_MS
    ) {
      last.endMs = f.ms
      last.lastFrameIndex = f.index
    } else {
      episodes.push({
        startMs: f.ms,
        endMs: f.ms,
        lastFrameIndex: f.index,
        dir: f.dir,
        success: false
      })
    }
  }
  for (const k of corridorKills.sort((a, b) => a.ms - b.ms)) {
    const distance = (e: (typeof episodes)[number]) => Math.max(e.startMs - k.ms, k.ms - e.endMs, 0)
    const hit = episodes
      .filter((e) => e.dir === k.dir && distance(e) <= 90_000)
      .sort((a, b) => distance(a) - distance(b))[0]
    if (hit) {
      hit.success = true
      hit.startMs = Math.min(hit.startMs, k.ms)
      hit.endMs = Math.max(hit.endMs, k.ms)
    } else {
      episodes.push({ startMs: k.ms, endMs: k.ms, lastFrameIndex: -1, dir: k.dir, success: true })
    }
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

/** 首次单杀与游走均限定前 14 分钟；升级事件比上一分钟的等级快照更精确。 */
export function analyzeOneTimeline(
  tl: { frames: any[] },
  selfPid: number,
  teamId: number,
  analyzed?: MidOneTimelineV2
): {
  firstSoloKill: { level: number | null } | null
  firstRoam: { timeMs: number; dir: RoamDir } | null
} {
  const frames = tl.frames ?? []
  const firstKill = frames
    .flatMap((f) => f.events ?? [])
    .filter(
      (ev) =>
        ev?.type === 'CHAMPION_KILL' &&
        isFiniteNumber(ev.timestamp) &&
        ev.timestamp >= 0 &&
        ev.timestamp <= EARLY_MS &&
        ev.killerId === selfPid &&
        Array.isArray(ev.assistingParticipantIds) &&
        ev.assistingParticipantIds.length === 0
    )
    .sort((a, b) => a.timestamp - b.timestamp)[0]
  const first = (analyzed ?? analyzeOneTimelineV2(tl, selfPid, teamId)).roamEpisodes[0]
  return {
    firstSoloKill: firstKill
      ? { level: levelAt(frames, selfPid, firstKill.timestamp, firstKill) }
      : null,
    firstRoam: first ? { timeMs: first.startMs, dir: first.dir } : null
  }
}

/** 空/中断/缺本人数据的时间线不能充当一次零表现；检查研究窗口已覆盖。 */
function hasUsableTimeline(tl: { frames: any[] }, game: MidLiteGame): boolean {
  const endMs = Math.min(game.gameDuration * 1000, EARLY_MS)
  const windowFrames = tl.frames.filter((f) => f.timestamp <= endMs + MAX_FRAME_GAP_MS)
  if (windowFrames.length < 2 || windowFrames[0].timestamp > 60_000) return false
  let previous = windowFrames[0].timestamp
  let covered = false
  let hasEarlyPosition = false
  for (const frame of windowFrames) {
    // SGP 的 participantFrame.position 为必需字段。缺一帧本人坐标就不能把这一场
    // 当作完整观察窗口；死亡/基地有合法坐标，是否计入地图由上层按健康值另行判断。
    if (
      frame.timestamp - previous > MAX_FRAME_GAP_MS ||
      !hasPosition(frame.participantFrames?.[String(game.selfPid)]?.position)
    )
      return false
    previous = frame.timestamp
    if (frame.timestamp >= 2 * 60_000 && frame.timestamp <= endMs) hasEarlyPosition = true
    if (frame.timestamp + 1000 >= endMs) {
      covered = true
      break
    }
  }
  return covered && hasEarlyPosition
}

/** 对最近 DEEP_GAMES 场逐局补时间线并聚合两大指标 */
export function emptyDeepResult(): MidDeepResult {
  return {
    deepGames: 0,
    attemptedGames: 0,
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
  signal?.throwIfAborted()
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
  let validGames = 0
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
    deepGames: validGames,
    attemptedGames: done,
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
        if (signal?.aborted) return
        const raw = await getTimeline(g.gameId)
        if (signal?.aborted) return
        const tl = normalizeTimeline(raw)
        if (tl && hasUsableTimeline(tl, g)) {
          const v2 = analyzeOneTimelineV2(
            tl,
            g.selfPid,
            g.teamId,
            g.enemyMidPid,
            g.participantTeams
          )
          const one = analyzeOneTimeline(tl, g.selfPid, g.teamId, v2)
          if (one.firstSoloKill) {
            firstKillGames++
            if (one.firstSoloKill.level !== null)
              firstKillBuckets[levelBucketIndex(one.firstSoloKill.level)]++
          }
          if (one.firstRoam) {
            roamGames++
            roamTimeBuckets[roamTimeBucketIndex(one.firstRoam.timeMs)]++
            roamDirs[one.firstRoam.dir]++
          }
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
          validGames++
        } else {
          timelineFailures++
        }
      } catch {
        if (signal?.aborted) return
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

  signal?.throwIfAborted()
  return snapshot()
}
