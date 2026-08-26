import type { AxiosInstance } from 'axios'

import type { LaneName } from '@shared/utils/lane-assignment'

/**
 * 对位克制助手 —— OP.GG 网页数据通道（纯逻辑模块）
 *
 * 整体胜率走官方 JSON 接口（见 counter-intel.ts），与原版软件同级稳定；
 * 本文件只负责「单杀率（Lane kill rate）」：该数据 OP.GG 仅在网页端提供
 * （官方接口中不存在，2026-08-26 已逐一核实），因此这里抓取
 * https://op.gg/lol/champions/{slug}/counters/{pos}?target_champion={opp}
 * 的 RSC 增量响应并做多策略解析。
 *
 * ⚠ 站点改版防护（三层）：
 *   1. 多解析策略互为备份（RSC 结构锚定 → 渲染 HTML 结构 → 放弃该条）
 *   2. 全部可变点集中在下方「可调区」，改版后只需调整此处
 *   3. 全部解析失败时优雅降级：单杀列显示"暂不可用"，胜率列不受影响
 */

// ==================================================================
// ======================== 可调区（集中配置） ========================
// ==================================================================

export const OPGG_WEB_BASE = 'https://op.gg'

/** Riot 官方 Data Dragon（英雄 id ↔ 英文名/别名映射来源，稳定公开） */
export const DDRAGON_VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json'
export const ddragonChampionUrl = (version: string) =>
  `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`

/** 统一分路名 → OP.GG 网页路径段 */
export const POSITION_TO_WEB_SEGMENT: Readonly<Record<LaneName, string>> = {
  top: 'top',
  jungle: 'jungle',
  middle: 'mid',
  bottom: 'adc',
  utility: 'support'
}

/** 名称规整后仍与 OP.GG slug 不一致的特例（key 为规整结果） */
export const SLUG_OVERRIDES: Readonly<Record<string, string>> = {
  nunuwillump: 'nunu',
  renataglasc: 'renata',
  monkeyking: 'wukong'
}

/** 单杀率标签候选（请求固定带 Accept-Language: en，首项即命中；保留扩展位以防站点改动） */
export const LANE_KILL_LABELS: readonly string[] = ['Lane kill rate']

/** 单杀率抓取覆盖的候选对手数量上限（按样本场次取前 N） */
export const LANE_KILL_TARGET_COUNT = 16

/** 单杀率抓取并发数 */
export const LANE_KILL_CONCURRENCY = 5

/** 抓取网页时使用的请求头 */
export const WEB_REQUEST_HEADERS: Readonly<Record<string, string>> = {
  RSC: '1',
  Accept: 'text/x-component,text/html;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
}

// ==================================================================
// ========================== 工具与映射 =============================
// ==================================================================

/** 英雄英文名 → OP.GG slug：小写并去掉非字母数字，再套用特例表 */
export function toOpggSlug(englishName: string): string {
  const normalized = englishName.toLowerCase().replace(/[^a-z0-9]/g, '')
  return SLUG_OVERRIDES[normalized] ?? normalized
}

/** 段位筛选 → 网页 tier 参数（字符串透传；数字就近折算） */
export function toWebTier(tier: string | number | undefined): string {
  if (tier === undefined || tier === null || tier === '') return 'emerald_plus'
  if (typeof tier === 'number') {
    if (tier >= 3) return 'diamond_plus'
    if (tier <= 1) return 'all'
    return 'emerald_plus'
  }
  return tier
}

/** 区服 → 网页 region 参数（同名透传，空值回退 global） */
export function toWebRegion(region: string | undefined): string {
  return region && region.length > 0 ? region : 'global'
}

export function buildCounterPageUrl(args: {
  slug: string
  position: LaneName
  region: string
  tier: string | number
  targetSlug?: string
}): string {
  const segment = POSITION_TO_WEB_SEGMENT[args.position]
  const params = new URLSearchParams()
  params.set('region', toWebRegion(args.region))
  params.set('tier', toWebTier(args.tier))
  if (args.targetSlug) {
    params.set('target_champion', args.targetSlug)
  }
  return `${OPGG_WEB_BASE}/lol/champions/${args.slug}/counters/${segment}?${params.toString()}`
}

/** RSC 响应本身是明文引号；嵌在整页 HTML 的 script 里则被 JS 字符串转义。统一还原后再解析。 */
export function normalizeFlightText(text: string): string {
  return text.replace(/\\"/g, '"')
}

// ==================================================================
// ======================= 解析策略（多层兜底） =======================
// ==================================================================

export interface FlightCounterEntry {
  name: string
  slug: string
  play: number
  win: number
  /** 页面口径：基准英雄对该对手的胜率（百分数） */
  winRatePercent: number
}

/**
 * 从 flight 数据中提取克制表条目（{"play":..,"win":..,"win_rate":..,"champion":{"name":..,"key":..}}）。
 * 用途：① 兜底校验 slug 映射；② 官方接口异常时的胜率备胎。
 */
export function parseFlightCounters(rawText: string): FlightCounterEntry[] {
  const text = normalizeFlightText(rawText)
  const out: FlightCounterEntry[] = []
  const re =
    /\{"play":(\d+),"win":(\d+),"win_rate":([0-9.]+),"champion":\{[^{}]*?"name":"([^"]+)","key":"([a-z0-9]+)"\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push({
      play: Number(m[1]),
      win: Number(m[2]),
      winRatePercent: Number(m[3]),
      name: m[4],
      slug: m[5]
    })
  }
  return out
}

export interface LaneKillPair {
  /** 左值：页面基准英雄（敌方对位）的单杀率（百分数） */
  leftPercent: number
  /** 右值：target_champion（我方候选）的单杀率（百分数） */
  rightPercent: number
}

function validatePair(left: number, right: number): LaneKillPair | null {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  if (left < 0 || right < 0 || left > 100 || right > 100) return null
  const sum = left + right
  if (sum < 98.5 || sum > 101.5) return null
  return { leftPercent: left, rightPercent: right }
}

/** 策略一：锚定 RSC 序列化元素中的标签节点，取其前后最近的两个百分数子节点 */
function parseLaneKillFromFlight(text: string, label: string): LaneKillPair | null {
  const anchor = `"children":"${label}"`
  const li = text.indexOf(anchor)
  if (li < 0) return null
  const windowStart = Math.max(0, li - 900)
  const windowEnd = Math.min(text.length, li + anchor.length + 900)
  const win = text.slice(windowStart, windowEnd)
  const anchorInWin = li - windowStart
  const re = /"children":"(\d{1,3}(?:\.\d+)?)%"/g
  let m: RegExpExecArray | null
  let left: number | null = null
  let right: number | null = null
  let leftDist = Infinity
  let rightDist = Infinity
  while ((m = re.exec(win))) {
    const v = Number(m[1])
    if (m.index < anchorInWin) {
      const d = anchorInWin - m.index
      if (d < leftDist) {
        leftDist = d
        left = v
      }
    } else if (m.index > anchorInWin) {
      const d = m.index - anchorInWin
      if (d < rightDist) {
        rightDist = d
        right = v
      }
    }
  }
  if (left === null || right === null) return null
  return validatePair(left, right)
}

/** 策略二：整页 HTML 已渲染结构（label 两侧相邻 span） */
function parseLaneKillFromHtml(text: string, label: string): LaneKillPair | null {
  const re = new RegExp(
    '>(\\d{1,3}(?:\\.\\d+)?)%<\\/span><span[^>]*>' +
      label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') +
      '<\\/span><span[^>]*>(\\d{1,3}(?:\\.\\d+)?)%',
    'i'
  )
  const m = re.exec(text)
  if (!m) return null
  return validatePair(Number(m[1]), Number(m[2]))
}

/** 多标签 × 多策略解析单杀率对；全部失败返回 null（调用方按"该条不可用"处理） */
export function parseLaneKillPair(rawText: string): LaneKillPair | null {
  const text = normalizeFlightText(rawText)
  for (const label of LANE_KILL_LABELS) {
    const fromFlight = parseLaneKillFromFlight(text, label)
    if (fromFlight) return fromFlight
    const fromHtml = parseLaneKillFromHtml(text, label)
    if (fromHtml) return fromHtml
  }
  return null
}

// ==================================================================
// ====================== Data Dragon 英雄映射 =======================
// ==================================================================

export interface ChampionSlugInfo {
  slug: string
  name: string
}

export async function fetchChampionSlugMap(
  web: AxiosInstance,
  signal?: AbortSignal
): Promise<Map<number, ChampionSlugInfo>> {
  const versionsRes = await web.get<string[]>(DDRAGON_VERSIONS_URL, { signal })
  const version = Array.isArray(versionsRes.data) ? versionsRes.data[0] : undefined
  if (!version) {
    throw new Error('Data Dragon versions 响应异常')
  }
  const champRes = await web.get<{ data: Record<string, { key: string; name: string }> }>(
    ddragonChampionUrl(version),
    { signal }
  )
  const map = new Map<number, ChampionSlugInfo>()
  const data = champRes.data?.data ?? {}
  for (const entry of Object.values(data)) {
    const id = Number(entry.key)
    if (!Number.isFinite(id)) continue
    map.set(id, { slug: toOpggSlug(entry.name), name: entry.name })
  }
  if (map.size === 0) {
    throw new Error('Data Dragon champion.json 响应异常')
  }
  return map
}

// ==================================================================
// ======================= 单杀率批量抓取 ============================
// ==================================================================

export interface LaneKillTarget {
  championId: number
  slug: string
}

export interface LaneKillFetchArgs {
  /** 敌方对位英雄的 slug（页面基准英雄） */
  baseSlug: string
  position: LaneName
  region: string
  tier: string | number
  targets: LaneKillTarget[]
  signal?: AbortSignal
  onWarn?: (message: string) => void
}

/**
 * 并行抓取各候选对手的单杀率。
 * 返回：championId → { enemyPercent, minePercent } | null（该条解析失败）。
 */
export async function fetchLaneKillRates(
  web: AxiosInstance,
  args: LaneKillFetchArgs
): Promise<Map<number, { enemyPercent: number; minePercent: number } | null>> {
  const results = new Map<number, { enemyPercent: number; minePercent: number } | null>()
  const queue = [...args.targets]

  const worker = async () => {
    for (;;) {
      const target = queue.shift()
      if (!target) return
      args.signal?.throwIfAborted()
      const url = buildCounterPageUrl({
        slug: args.baseSlug,
        position: args.position,
        region: args.region,
        tier: args.tier,
        targetSlug: target.slug
      })
      try {
        const res = await web.get<string>(url, {
          signal: args.signal,
          headers: { ...WEB_REQUEST_HEADERS },
          responseType: 'text',
          transformResponse: [(d: any) => d]
        })
        const pair = parseLaneKillPair(String(res.data ?? ''))
        if (pair) {
          results.set(target.championId, {
            enemyPercent: pair.leftPercent,
            minePercent: pair.rightPercent
          })
        } else {
          results.set(target.championId, null)
          args.onWarn?.(`单杀率解析未命中 (target=${target.slug})`)
        }
      } catch (error: any) {
        if (args.signal?.aborted) {
          throw error
        }
        results.set(target.championId, null)
        args.onWarn?.(`单杀率抓取失败 (target=${target.slug}): ${error?.message ?? error}`)
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(LANE_KILL_CONCURRENCY, Math.max(1, args.targets.length)) },
    () => worker()
  )
  await Promise.all(workers)
  return results
}
