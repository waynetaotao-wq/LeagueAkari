/**
 * DraftGap 实时取数客户端（我方新写代码，非 vendor）
 *
 * 实弹核准的取数路线（2026-08，详见 vendor/PORTING-NOTES.md 第4条）：
 *   - champion 数据（基础胜率 + 五路对位表）：
 *       第一层  ax.lolalytics.com mega 直连（现网对外 404，保留作先行探测，
 *               万一某环境放行即白赚轻量通道；单次尝试、不重试、失败静默降级）
 *       第二层  官网页面 qwik/json 解析（现网验证可用；vendor/qwik.ts 的
 *               extractData 复用，URL 构造照抄其参数集，tier 可注入）
 *   - build-team 数据（四路协同表）：a1.lolalytics.com mega 直连（现网验证可用）
 *
 * tier 默认 diamond_plus（钻4~王者），patch 默认 "30"（最近30天）。
 * 名称归一化（小写、monkeyking→wukong）照抄 vendor 行为。
 */
import { retry } from './vendor/utils'
import { getChampions, getVersions, type RiotChampion } from './vendor/riot'
import { extractData, type QwikLolalyticsData } from './vendor/lolalytics/qwik'
import type { LolalyticsRole } from './vendor/lolalytics/roles'

/** 数据口径默认值：全球 · 钻石4以上 · 单双排 */
export const DEFAULT_TIER = 'diamond_plus'
/** Lolalytics 的"最近30天"口径（patch 参数的特殊取值） */
export const THIRTY_DAYS_PATCH = '30'

const MEGA_CHAMPION_ENDPOINT = 'https://ax.lolalytics.com/mega/'
const MEGA_TEAM_ENDPOINT = 'https://a1.lolalytics.com/mega/'
const QWIK_PAGE_BASE = 'https://lolalytics.com/lol'

export interface SourceOptions {
  patch?: string
  tier?: string
}

export interface ChampionRef {
  /** Riot 数字 key 的字符串形式，如 "238" */
  key: string
  /** Riot 英文 id，如 "Zed"、"MonkeyKing" */
  id: string
}

/* ---------------- 并发闸门（对外站保持礼貌） ---------------- */

const MAX_CONCURRENT = 6
let active = 0
const waiters: Array<() => void> = []

async function gate<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve))
  }
  active++
  try {
    return await fn()
  } finally {
    active--
    const next = waiters.shift()
    if (next) next()
  }
}

/* ---------------- 带缓存的执行器 ---------------- */

/** 以 Promise 为值的缓存：并发请求同一资源时天然合流，只发一次网络请求 */
const cache = new Map<string, Promise<unknown>>()

export function clearRealtimeCache() {
  cache.clear()
}

export function realtimeCacheSize() {
  return cache.size
}

function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit) return hit as Promise<T>
  const p = gate(fn)
  cache.set(key, p as Promise<unknown>)
  p.catch(() => cache.delete(key))
  return p
}

/** 照抄 vendor：URL 中的英雄名用英文小写 id，悟空特例 */
export function normalizeChampionIdForUrl(championId: string): string {
  let id = championId.toLowerCase()
  if (id === 'monkeyking') id = 'wukong'
  return id
}

/* ---------------- champion 数据（双层通道） ---------------- */

function buildMegaChampionUrl(key: string, lane: LolalyticsRole, patch: string, tier: string) {
  const q = new URLSearchParams()
  q.append('ep', 'champion')
  q.append('p', 'd')
  q.append('v', '1')
  q.append('tier', tier)
  q.append('queue', '420')
  q.append('region', 'all')
  q.append('patch', patch)
  q.append('cid', key)
  q.append('lane', lane)
  return `${MEGA_CHAMPION_ENDPOINT}?${q.toString()}`
}

function buildQwikPageUrl(id: string, lane: LolalyticsRole, patch: string, tier: string) {
  const q = new URLSearchParams()
  q.append('tier', tier)
  q.append('region', 'all')
  q.append('patch', patch)
  q.append('lane', lane)
  return `${QWIK_PAGE_BASE}/${normalizeChampionIdForUrl(id)}/build/?${q.toString()}`
}

/**
 * 拉取某英雄某分路的 champion 数据。
 * 返回值为两种形状之一（组装器已做兼容）：
 *   mega 形状：{ header:{n,wr,damage}, enemy_top:[[...]], ... }
 *   qwik 形状：{ header:{n,wr,damage}, enemy:{top:[[...]],...}, sidebar:{...} }
 */
export function fetchChampionLane(
  champion: ChampionRef,
  lane: LolalyticsRole,
  opts: SourceOptions = {}
): Promise<unknown> {
  const patch = opts.patch ?? THIRTY_DAYS_PATCH
  const tier = opts.tier ?? DEFAULT_TIER
  const key = `champion:${champion.key}:${lane}:${patch}:${tier}`
  return cached(key, async () => {
    // 第一层：mega 直连，单次尝试，失败即静默降级
    try {
      const res = await fetch(buildMegaChampionUrl(champion.key, lane, patch, tier))
      if (res.ok) {
        const json: any = await res.json()
        if (json && json.header && typeof json.header.n === 'number') {
          return json
        }
      }
    } catch {
      /* 降级 */
    }
    // 第二层：官网页面 qwik/json（实测主通道）
    return retry(async () => {
      const res = await fetch(buildQwikPageUrl(champion.id, lane, patch, tier))
      if (!res.ok) {
        throw new Error(`lolalytics page ${res.status} for ${champion.id}@${lane}`)
      }
      const text = await res.text()
      if (!text) throw new Error(`empty page for ${champion.id}@${lane}`)
      const data: QwikLolalyticsData = extractData(text)
      return data
    })
  })
}

/* ---------------- build-team 数据（a1 直连，实测可用） ---------------- */

export function fetchTeamSynergy(
  championId: string,
  lane: LolalyticsRole,
  opts: SourceOptions = {}
): Promise<unknown> {
  const patch = opts.patch ?? THIRTY_DAYS_PATCH
  const tier = opts.tier ?? DEFAULT_TIER
  const cname = normalizeChampionIdForUrl(championId)
  const q = new URLSearchParams()
  q.append('ep', 'build-team')
  q.append('v', '1')
  q.append('tier', tier)
  q.append('queue', 'ranked')
  q.append('region', 'all')
  q.append('patch', patch)
  q.append('c', cname)
  q.append('lane', lane)
  const url = `${MEGA_TEAM_ENDPOINT}?${q.toString()}`
  return cached(`team:${cname}:${lane}:${patch}:${tier}`, () =>
    retry(async () => {
      const res = await fetch(url)
      if (!res.ok) throw new Error(`lolalytics ${res.status} for ${url}`)
      return (await res.json()) as unknown
    })
  )
}

/* ---------------- 英雄索引（数字 key ↔ 英文 id） ---------------- */

export interface ChampionIndexEntry {
  id: string
  key: string
  name: string
}

export interface ChampionIndex {
  version: string
  byKey: Map<string, ChampionIndexEntry>
  byId: Map<string, ChampionIndexEntry>
}

let championIndexPromise: Promise<ChampionIndex> | null = null

/** ddragon 版本 + 英雄清单（复用 vendor/riot 的官方实现），进程内缓存 */
export function loadChampionIndex(): Promise<ChampionIndex> {
  if (championIndexPromise) return championIndexPromise
  championIndexPromise = (async () => {
    const versions = await retry(() => getVersions())
    const version = versions[0]
    const champs: Pick<RiotChampion, 'id' | 'key' | 'name'>[] = await retry(() =>
      getChampions(version, 'zh_CN')
    )
    const byKey = new Map<string, ChampionIndexEntry>()
    const byId = new Map<string, ChampionIndexEntry>()
    for (const c of champs) {
      const entry: ChampionIndexEntry = { id: c.id, key: String(c.key), name: c.name }
      byKey.set(entry.key, entry)
      byId.set(entry.id, entry)
    }
    return { version, byKey, byId }
  })()
  championIndexPromise.catch(() => {
    championIndexPromise = null
  })
  return championIndexPromise
}

/** 当前对局版本号（形如 "26.4"），来自 ddragon versions[0] 截前两段 */
export async function getCurrentPatchTwoPart(): Promise<string> {
  const idx = await loadChampionIndex()
  return idx.version.split('.').slice(0, 2).join('.')
}
