import { LOLPS_REGIONS, LOLPS_TIERS } from '@shared/data-adapter/champion-data/lolps'
import type {
  LolpsChampionBuildPayload,
  LolpsChampionItem,
  LolpsChampionsPayload
} from '@shared/data-adapter/champion-data/lolps'
import type { ChampionDataPosition } from '@shared/data-adapter/champion-data/types'
import axios, { AxiosInstance } from 'axios'

import type { HttpApiRequestOptions } from '../request-options'

/**
 * LolpsHttpApiAxiosHelper —— lol.ps (韩国/北美) 数据源的 HTTP 客户端
 *
 * 抓取 lol.ps 的四个英雄详情接口与梯队列表接口，并把结果整理成
 * OP.GG 线格式的载荷（LolpsChampionsPayload / LolpsChampionBuildPayload），
 * 再由 data-adapter/champion-data/lolps.ts 翻译成应用统一的 ChampionData* 结构。
 *
 * ⚠ 重要说明：
 * lol.ps 没有公开的 API 文档。本文件的接口路径、参数与响应结构已于 2026-08-26
 * 通过浏览器对线上真实站点逐一核对。同时保留了多层兜底（多候选路径、多候选字段、
 * 坏数据逐条跳过），以应对站点未来改版：
 *   1. 每类接口给出多个候选路径，运行时逐个尝试，成功的会被缓存（见 ENDPOINT_CANDIDATES）
 *   2. 每个字段给出多个候选名称（见各 extract* 函数）
 *   3. 单条数据解析失败只跳过该条并打 console.warn，不会导致整个面板崩溃
 * 如果发现数据不对，请打开 https://lol.ps 任意英雄详情页，按 F12 → Network → Fetch/XHR，
 * 对照真实请求，只需修改本文件顶部「可调区」的常量即可。
 */

// ==================================================================
// ======================== 可调区（集中配置） ========================
// ==================================================================

/** 每类资源的候选路径，按顺序尝试，首个成功的会被缓存 */
const ENDPOINT_CANDIDATES = {
  arguments: (championId: number) => [`/champ/${championId}/arguments.json`],
  tierList: () => ['/statistics/tierlist.json', '/statistics/tierList.json'],
  runes: (championId: number) => [
    `/champ/${championId}/runestatperk.json`,
    `/champ/${championId}/rune-stat-perk.json`,
    `/champ/${championId}/runes.json`
  ],
  spellItem: (championId: number) => [
    `/champ/${championId}/spellitem.json`,
    `/champ/${championId}/spell-item.json`,
    `/champ/${championId}/spellItem.json`
  ],
  skill: (championId: number) => [
    `/champ/${championId}/skill.json`,
    `/champ/${championId}/skills.json`,
    `/champ/${championId}/mastery.json`
  ],
  versus: (championId: number) => [
    `/champ/${championId}/versus.json`,
    `/champ/${championId}/counter.json`
  ]
}

/** 应用统一位置名 → lol.ps lane 参数 */
const POSITION_TO_LANE: Record<string, number> = {
  top: 0,
  jungle: 1,
  middle: 2,
  bottom: 3,
  utility: 4
}

/** lane 序号 → OP.GG 线格式位置名（大写） */
const LANE_TO_POSITION_NAME = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const

/** 仅接受站点真实支持的选项；不支持的地区/段位由 UI 明示调整。 */
function toLolpsTier(tier: string | number | undefined): number {
  if (tier === undefined) return LOLPS_TIERS.emerald_plus
  const value = typeof tier === 'number' ? tier : LOLPS_TIERS[tier]
  if (value === undefined || !Object.values(LOLPS_TIERS).includes(value)) {
    throw new Error(`LOL.PS unsupported tier: ${tier}`)
  }
  return value
}

function toLolpsRegion(region: string | undefined): number {
  const key = region ?? 'kr'
  if (!Object.hasOwn(LOLPS_REGIONS, key)) throw new Error(`LOL.PS unsupported region: ${region}`)
  return LOLPS_REGIONS[key]
}

/** 版本列表来源：版本数据嵌在 SSR 页面 HTML 中（无独立 JSON 接口, 实测确认）。
 *  形如 versionId:154,description:"26.17" —— 显示名 "26.17" ↔ 接口值 154 */
const LOLPS_VERSION_PAGE = 'https://lol.ps/statistics'
const VERSION_INFO_REGEX = /versionId\s*:\s*(\d+)\s*,\s*description\s*:\s*"([^"]+)"/g

// ==================================================================
// ================= 提取器输出的中间形状（OP.GG 线格式） =============
// ==================================================================

interface OpggLikeCombEntry {
  ids: number[]
  play: number
  win_rate: number | null
  pick_rate: number | null
}

interface OpggLikeRuneEntry {
  id: number
  primary_page_id: number
  primary_rune_ids: number[]
  secondary_page_id: number
  secondary_rune_ids: number[]
  stat_mod_ids: number[]
  play: number
  win_rate: number | null
  pick_rate: number | null
}

interface OpggLikeCounter {
  champion_id: number
  play: number
  win_rate: number | null
}

// ==================================================================
// ========================== 工具函数 ==============================
// ==================================================================

const isAbort = (e: any) =>
  axios.isCancel(e) || e?.name === 'CanceledError' || e?.name === 'AbortError'

/** 取对象上第一个非 undefined/null 的候选字段 */
function pickField(obj: any, keys: string[]): any {
  if (!obj || typeof obj !== 'object') {
    return undefined
  }
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) {
      return obj[k]
    }
  }
  return undefined
}

function toNumber(v: any): number | undefined {
  if ((typeof v !== 'string' && typeof v !== 'number') || (typeof v === 'string' && !v.trim())) {
    return undefined
  }
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

/** LOL.PS 的 winRate / pickRate / banRate 均为百分数，包括 0.5 = 0.5%。 */
function toRate(v: any): number | null {
  const n = toNumber(v)
  return n === undefined || n < 0 || n > 100 ? null : n / 100
}

/** 返回值声明了筛选身份时必须匹配，不能把服务端默认数据套上用户的筛选标签。 */
function assertIdentity(raw: any, params: Record<string, any>) {
  if (!raw || typeof raw !== 'object') return
  const records = Array.isArray(raw) ? raw : [raw, ...Object.values(raw)]
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue
    for (const key of ['region', 'version', 'tier', 'lane', 'champion']) {
      if (params[key] === undefined || record[`${key}Id`] === undefined) continue
      if (Number(record[`${key}Id`]) !== Number(params[key])) {
        throw new Error(`LOL.PS response ${key} does not match requested filter`)
      }
    }
  }
}

function tierData(row: any) {
  const grade = toNumber(row?.opTier)
  const rank = toNumber(row?.ranking) ?? null
  const change = toNumber(row?.rankingVariation)
  return {
    tier: row?.isOp === true ? 0 : grade !== undefined && grade >= 0 && grade <= 5 ? grade : null,
    rank,
    rank_prev: rank !== null && change !== undefined ? rank + change : null
  }
}

/** 解析 id 列表：兼容 [1,2] / "1,2" / "1/2" / "1|2" / [{itemId:1}] / 单个数字 */
function toIdList(v: any): number[] {
  if (v === undefined || v === null) {
    return []
  }
  if (Array.isArray(v)) {
    // 实测 starting.itemIdList 形如 [[1101],[2003]]：先展平嵌套数组
    return v
      .flat(3)
      .map((item) => {
        if (typeof item === 'object' && item !== null) {
          return toNumber(
            pickField(item, ['itemId', 'item_id', 'id', 'spellId', 'perkId', 'runeId'])
          )
        }
        return toNumber(item)
      })
      .filter((n): n is number => n !== undefined)
  }
  if (typeof v === 'number') {
    return [v]
  }
  if (typeof v === 'string') {
    return v
      .split(/[,/|;+\s]+/)
      .map((s) => toNumber(s))
      .filter((n): n is number => n !== undefined)
  }
  return []
}

/** 在对象中找到第一个「元素为对象的数组」字段，key 匹配任一正则 */
function findArrayField(obj: any, patterns: RegExp[]): any[] | undefined {
  if (!obj || typeof obj !== 'object') {
    return undefined
  }
  if (Array.isArray(obj)) {
    return obj
  }
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key]) && patterns.some((p) => p.test(key))) {
      return obj[key]
    }
  }
  // 兜底：任意数组字段
  for (const key of Object.keys(obj)) {
    if (Array.isArray(obj[key]) && obj[key].length && typeof obj[key][0] === 'object') {
      return obj[key]
    }
  }
  return undefined
}

/** 符文 id → 系别（大类）id 的兜底映射，仅在接口没有直接给出系别时使用 */
const RUNE_TO_STYLE: Record<number, number> = (() => {
  const table: Record<number, number[]> = {
    8000: [8005, 8008, 8010, 8021, 9101, 9103, 9104, 9105, 9111, 8009, 8014, 8017, 8299],
    8100: [
      8112, 8124, 8128, 9923, 8120, 8126, 8134, 8135, 8136, 8137, 8138, 8139, 8140, 8141, 8143,
      8105, 8106
    ],
    8200: [8214, 8229, 8230, 8210, 8224, 8226, 8232, 8233, 8234, 8236, 8237, 8242, 8275],
    8300: [8351, 8360, 8369, 8304, 8306, 8313, 8316, 8321, 8345, 8347, 8352, 8410],
    8400: [8437, 8439, 8465, 8401, 8429, 8444, 8446, 8451, 8453, 8463, 8473]
  }
  const out: Record<number, number> = {}
  for (const [style, runes] of Object.entries(table)) {
    for (const r of runes) {
      out[r] = Number(style)
    }
  }
  return out
})()

// ==================================================================
// ============================ 主类 ================================
// ==================================================================

export class LolpsHttpApiAxiosHelper {
  static BASE_URL = 'https://lol.ps/api'

  /** 成功过的 endpoint 缓存：资源类别 → 候选路径的序号。
   *  注意存的是序号而不是完整路径：候选路径中带英雄 id（如 /champ/64/skill.json），
   *  若缓存完整路径，切换英雄后会错误复用上一个英雄的路径。 */
  private _epCache = new Map<string, number>()

  /** 版本显示名 → lol.ps 接口实际使用的 version 值 */
  private _versionMap = new Map<string, number>()

  constructor(private _http: AxiosInstance) {
    if (!_http.defaults.baseURL) {
      _http.defaults.baseURL = LolpsHttpApiAxiosHelper.BASE_URL
    }
  }

  // ------------------------- 底层请求 -------------------------

  private _unwrap(payload: any): any {
    let data = payload
    if (data && typeof data === 'object' && 'data' in data) {
      data = data.data
    }
    if (typeof data === 'string') {
      try {
        data = JSON.parse(data)
      } catch {
        /* 保持原样 */
      }
    }
    return data
  }

  private async _get(
    cacheKey: string,
    candidates: string[],
    params: Record<string, any>,
    signal?: AbortSignal
  ): Promise<any> {
    const cachedIdx = this._epCache.get(cacheKey)
    const tryList =
      cachedIdx !== undefined && cachedIdx >= 0 && cachedIdx < candidates.length
        ? [candidates[cachedIdx], ...candidates.filter((_, i) => i !== cachedIdx)]
        : candidates

    let lastError: any = null
    for (const path of tryList) {
      try {
        const res = await this._http.get(path, { params, signal })
        const raw = this._unwrap(res.data)
        if (cacheKey !== 'arguments') assertIdentity(raw, params)
        this._epCache.set(cacheKey, candidates.indexOf(path))
        return raw
      } catch (error: any) {
        if (isAbort(error)) {
          throw error
        }
        lastError = error
        // 404 / 400 之类换下一个候选路径；网络错误也继续尝试
      }
    }
    throw lastError ?? new Error(`lol.ps request failed: ${cacheKey}`)
  }

  private async _resolveVersion(display: string | undefined, signal?: AbortSignal) {
    if (display && /^\d+$/.test(display)) return { id: Number(display), display }
    if (!display || !this._versionMap.has(display)) {
      const versions = await this.getVersions({ signal })
      display ??= versions.data[0]
    }
    const id = display ? this._versionMap.get(display) : undefined
    if (!display || id === undefined)
      throw new Error(`LOL.PS unknown patch: ${display ?? 'latest'}`)
    return { id, display }
  }

  // ------------------------- 版本列表 -------------------------

  /**
   * 返回 { data: string[] }（显示名列表，如 ["26.17", "26.16", ...]）。
   * 实测：版本列表嵌在 lol.ps 页面的 SSR HTML 中（无独立 JSON 接口），
   * 因此抓取 /statistics 页面并正则提取 versionId/description 对（154 ↔ "26.17"）。
   */
  async getVersions(options: HttpApiRequestOptions = {}): Promise<{ data: string[] }> {
    const nextMap = new Map<string, number>()
    const displays: string[] = []

    try {
      const res = await this._http.get(LOLPS_VERSION_PAGE, {
        signal: options.signal,
        responseType: 'text',
        transformResponse: [(d: any) => d]
      })
      const html = String(res.data ?? '')
      for (const m of html.matchAll(VERSION_INFO_REGEX)) {
        const vid = Number(m[1])
        const display = m[2]
        if (Number.isFinite(vid) && display && !displays.includes(display)) {
          displays.push(display)
          nextMap.set(display, vid)
        }
      }
    } catch (error) {
      if (isAbort(error)) {
        throw error
      }
      console.warn('[LOL.PS] 从页面提取版本列表失败, 退回 arguments.json', error)
    }

    if (displays.length) {
      this._versionMap = nextMap
      return { data: displays }
    }

    // 兜底：arguments.json 只能拿到最新版本号（无显示名，直接展示数字本身）
    const raw = await this._get('arguments', ENDPOINT_CANDIDATES.arguments(1), {}, options.signal)
    const vid = toNumber(pickField(raw, ['versionId', 'version_id', 'version']))
    if (vid !== undefined) {
      const display = String(vid)
      nextMap.set(display, vid)
      this._versionMap = nextMap
      return { data: [display] }
    }
    return { data: [] }
  }

  // ------------------------- 梯队列表 -------------------------

  /**
   * lol.ps 的梯队接口按 lane 查询，这里并行请求 5 个 lane 后按英雄合并，
   * 输出 OP.GG 线格式（含 tier_data.rank_prev，供统一翻译器计算排名变化）。
   */
  async getChampions(
    query: { region?: string; tier?: string | number; version?: string },
    options: HttpApiRequestOptions = {}
  ): Promise<LolpsChampionsPayload> {
    const lolpsTier = toLolpsTier(query.tier)
    const region = toLolpsRegion(query.region)
    const version = await this._resolveVersion(query.version, options.signal)

    const laneResults = await Promise.all(
      LANE_TO_POSITION_NAME.map(async (_, lane) => {
        try {
          const raw = await this._get(
            'tierList',
            ENDPOINT_CANDIDATES.tierList(),
            { region, version: version.id, tier: lolpsTier, lane },
            options.signal
          )
          const arr = Array.isArray(raw) ? raw : (findArrayField(raw, [/list|data|champ/i]) ?? [])
          return arr as any[]
        } catch (error) {
          if (isAbort(error)) {
            throw error
          }
          console.warn(`[LOL.PS] 获取 lane=${lane} 梯队数据失败`, error)
          return [] as any[]
        }
      })
    )

    if (laneResults.every((r) => r.length === 0)) {
      throw new Error('LOL.PS 梯队数据为空, 请检查接口参数 (见 lolps helper 顶部可调区)')
    }

    const byId = new Map<number, LolpsChampionItem>()

    laneResults.forEach((list, lane) => {
      const positionName = LANE_TO_POSITION_NAME[lane]
      list.forEach((c) => {
        const id = toNumber(pickField(c, ['championId', 'champion_id', 'championKey', 'id']))
        if (id === undefined) {
          return
        }

        const winRate = toRate(pickField(c, ['winRate', 'win_rate', 'winrate']))
        const pickRate = toRate(pickField(c, ['pickRate', 'pick_rate', 'pickrate']))
        const banRate = toRate(pickField(c, ['banRate', 'ban_rate', 'banrate']))
        const play = toNumber(pickField(c, ['count', 'play', 'games', 'totalCount'])) ?? 0

        const grades = tierData(c)
        const tierGrade = grades.tier
        const rank = grades.rank

        let entry = byId.get(id)
        if (!entry) {
          entry = {
            id,
            average_stats: {
              play,
              win: null,
              win_rate: winRate,
              pick_rate: pickRate,
              ban_rate: banRate,
              kda: null,
              tier: tierGrade,
              rank,
              tier_data: { ...grades }
            },
            positions: []
          }
          byId.set(id, entry)
        }

        entry.positions.push({
          name: positionName,
          stats: {
            play,
            win: null,
            win_rate: winRate,
            pick_rate: pickRate,
            ban_rate: banRate,
            kda: null,
            role_rate: null,
            tier_data: { ...grades }
          },
          counters: [] // lol.ps 的对位数据在英雄详情接口中提供 (getChampion → data.counters)
        })
      })
    })

    // 补充 role_rate（该英雄在各位置的出场占比），并把 average_stats 对齐到出场最多的位置，
    // 与 OP.GG 排位梯队数据的形状保持一致（首次合并时 average_stats 来自 lane 0，未必是主位置）
    for (const entry of byId.values()) {
      const totalPlay = entry.positions.reduce((acc, p) => acc + (p.stats.play ?? 0), 0) || 1
      let main = entry.positions[0]
      for (const p of entry.positions) {
        p.stats.role_rate = (p.stats.play ?? 0) / totalPlay
        if ((p.stats.play ?? 0) > (main.stats.play ?? 0)) {
          main = p
        }
      }
      if (entry.average_stats && main) {
        entry.average_stats.play = main.stats.play
        entry.average_stats.win = main.stats.win
        entry.average_stats.win_rate = main.stats.win_rate
        entry.average_stats.pick_rate = main.stats.pick_rate
        entry.average_stats.ban_rate = main.stats.ban_rate
        entry.average_stats.tier = main.stats.tier_data.tier
        entry.average_stats.rank = main.stats.tier_data.rank
        entry.average_stats.tier_data = { ...main.stats.tier_data }
      }
    }

    return {
      data: [...byId.values()],
      meta: {
        version: version.display,
        cached_at: new Date().toISOString()
      }
    }
  }

  // ------------------------- 英雄详情 -------------------------

  /**
   * 汇合 runestatperk / spellitem / skill / versus 四个接口（外加所选 lane 的梯队行
   * 用于填充 summary），输出 OP.GG 线格式的英雄详情载荷。
   */
  async getChampion(
    championId: number,
    query: {
      region?: string
      position?: ChampionDataPosition
      tier?: string | number
      version?: string
    },
    options: HttpApiRequestOptions = {}
  ): Promise<LolpsChampionBuildPayload> {
    const lane = POSITION_TO_LANE[query.position ?? 'middle']
    if (lane === undefined) throw new Error(`LOL.PS unsupported position: ${query.position}`)
    const region = toLolpsRegion(query.region)
    const tier = toLolpsTier(query.tier)
    const version = await this._resolveVersion(query.version, options.signal)
    const requestQuery = {
      region,
      version: version.id,
      tier,
      lane,
      champion: championId // 站点自身的请求也带上此参数, 保持一致
    }

    const load = async (cacheKey: string, candidates: string[]) => {
      try {
        return await this._get(cacheKey, candidates, requestQuery, options.signal)
      } catch (error) {
        if (isAbort(error)) {
          throw error
        }
        console.warn(`[LOL.PS] 获取 ${cacheKey} 数据失败 (championId=${championId})`, error)
        return null
      }
    }

    const loadSummaryRow = async () => {
      try {
        const raw = await this._get(
          'tierList',
          ENDPOINT_CANDIDATES.tierList(),
          {
            region,
            version: requestQuery.version,
            tier: requestQuery.tier,
            lane
          },
          options.signal
        )
        const arr = Array.isArray(raw) ? raw : (findArrayField(raw, [/list|data|champ/i]) ?? [])
        const index = arr.findIndex(
          (c: any) =>
            toNumber(pickField(c, ['championId', 'champion_id', 'championKey', 'id'])) ===
            championId
        )
        if (index < 0) {
          return null
        }
        return { row: arr[index] }
      } catch (error) {
        if (isAbort(error)) {
          throw error
        }
        console.warn(`[LOL.PS] 获取梯队摘要失败 (championId=${championId})`, error)
        return null
      }
    }

    const [runesRaw, spellItemRaw, skillRaw, versusRaw, summaryRow] = await Promise.all([
      load('runes', ENDPOINT_CANDIDATES.runes(championId)),
      load('spellItem', ENDPOINT_CANDIDATES.spellItem(championId)),
      load('skill', ENDPOINT_CANDIDATES.skill(championId)),
      load('versus', ENDPOINT_CANDIDATES.versus(championId)),
      loadSummaryRow()
    ])

    if (runesRaw === null && spellItemRaw === null && skillRaw === null && versusRaw === null) {
      throw new Error(
        'LOL.PS 英雄详情数据全部获取失败, 请检查接口路径/参数 (见 lolps helper 顶部可调区) 或网络配置'
      )
    }

    const runes = this._extractRunes(runesRaw)
    const { summonerSpells, starterItems, boots, coreItems, lastItems } =
      this._extractSpellsAndItems(spellItemRaw)
    const skillMasteries = this._extractSkills(skillRaw)
    const counters = this._extractCounters(versusRaw)

    const summary = this._buildSummary(championId, lane, summaryRow)

    // 关键: starter_items / boots / core_items / last_items 必须始终为数组,
    // 统一翻译器会直接对它们做 map。
    return {
      data: {
        summary,
        summoner_spells: summonerSpells.filter((item) => item.win_rate !== null),
        runes: runes.filter((item) => item.win_rate !== null),
        skill_masteries: skillMasteries,
        starter_items: starterItems.filter((item) => item.win_rate !== null),
        boots: boots.filter((item) => item.win_rate !== null),
        core_items: coreItems.filter((item) => item.win_rate !== null),
        last_items: lastItems.filter((item) => item.win_rate !== null),
        counters: counters.filter((item) => item.win_rate !== null)
      },
      meta: {
        version: version.display,
        cached_at: new Date().toISOString()
      }
    }
  }

  /** 由所选 lane 的梯队行构造 summary（找不到该英雄时给出空占位） */
  private _buildSummary(
    championId: number,
    lane: number,
    summaryRow: { row: any } | null
  ): LolpsChampionBuildPayload['data']['summary'] {
    if (!summaryRow) {
      return { id: championId, average_stats: null, positions: [] }
    }

    const { row } = summaryRow
    const winRate = toRate(pickField(row, ['winRate', 'win_rate', 'winrate']))
    const pickRate = toRate(pickField(row, ['pickRate', 'pick_rate', 'pickrate']))
    const banRate = toRate(pickField(row, ['banRate', 'ban_rate', 'banrate']))
    const play = toNumber(pickField(row, ['count', 'play', 'games', 'totalCount'])) ?? 0

    const grades = tierData(row)
    const tierGrade = grades.tier
    const rank = grades.rank

    return {
      id: championId,
      average_stats: {
        play,
        win: null,
        win_rate: winRate,
        pick_rate: pickRate,
        ban_rate: banRate,
        kda: null,
        tier: tierGrade,
        rank,
        tier_data: { ...grades }
      },
      positions: [
        {
          name: LANE_TO_POSITION_NAME[lane] ?? 'MID',
          stats: {
            play,
            win: null,
            win_rate: winRate,
            pick_rate: pickRate,
            ban_rate: banRate,
            kda: null,
            role_rate: null,
            tier_data: { ...grades }
          },
          counters: []
        }
      ]
    }
  }

  // ------------------------- 提取器们 -------------------------

  private _extractRunes(raw: any): OpggLikeRuneEntry[] {
    if (!raw) {
      return []
    }

    // ---- 主路径（实测 2026-08-26 结构）：runeWinrates.total = 完整符文页组合,
    //      statperkWinrates = 按序号键("0","1"...)排列的属性碎片组合 ----
    const rw = raw.runeWinrates
    const spw = raw.statperkWinrates
    if (rw && Array.isArray(rw.total) && rw.total.length) {
      const statCombos = (
        Array.isArray(spw) ? spw : spw && typeof spw === 'object' ? Object.values(spw) : []
      ).filter((x: any) => x && typeof x === 'object')
      statCombos.sort((a: any, b: any) => (toNumber(b.count) ?? 0) - (toNumber(a.count) ?? 0))
      const topStat = toIdList(statCombos[0]?.statperkIdList).slice(0, 3)

      const totals = [...rw.total].sort(
        (a: any, b: any) => (toNumber(b?.count) ?? 0) - (toNumber(a?.count) ?? 0)
      )
      const primary: OpggLikeRuneEntry[] = []
      totals.forEach((r: any, index: number) => {
        const primaryIds = toIdList(r?.category1RuneIdList)
        const secondaryIds = toIdList(r?.category2RuneIdList)
        if (primaryIds.length < 4 || secondaryIds.length < 2) {
          return
        }
        const primaryPageId = toNumber(r?.runeCategory1) ?? RUNE_TO_STYLE[primaryIds[0]]
        const secondaryPageId = toNumber(r?.runeCategory2) ?? RUNE_TO_STYLE[secondaryIds[0]]
        if (!primaryPageId || !secondaryPageId) {
          return
        }
        const play = toNumber(r?.count) ?? 0
        const winRate = toRate(r?.winRate)
        primary.push({
          id: index,
          primary_page_id: primaryPageId,
          primary_rune_ids: primaryIds.slice(0, 4),
          secondary_page_id: secondaryPageId,
          secondary_rune_ids: secondaryIds.slice(0, 2),
          stat_mod_ids: topStat,
          play,
          win_rate: winRate,
          pick_rate: toRate(r?.pickRate)
        })
      })
      if (primary.length) {
        return primary
      }
    }

    // ---- 兜底：旧启发式（站点未来改版时兜住） ----
    const list = findArrayField(raw, [/rune/i, /perk/i, /list/i]) ?? (Array.isArray(raw) ? raw : [])

    const out: OpggLikeRuneEntry[] = []

    list.forEach((r: any, index: number) => {
      try {
        let primaryIds = toIdList(
          pickField(r, [
            'mainRuneIds',
            'mainRuneIdList',
            'mainRunes',
            'primaryRuneIds',
            'perkPrimaryIdList',
            'mainRune'
          ])
        )
        let secondaryIds = toIdList(
          pickField(r, [
            'subRuneIds',
            'subRuneIdList',
            'subRunes',
            'secondaryRuneIds',
            'perkSubIdList',
            'subRune'
          ])
        )
        let statIds = toIdList(
          pickField(r, [
            'statperkIds',
            'statPerkIds',
            'statperkIdList',
            'statPerkIdList',
            'statShards',
            'statMods',
            'statperk'
          ])
        )

        // Riot 风格字段: perk0..perk5 + statPerk0..2
        if (primaryIds.length === 0 && r.perk0 !== undefined) {
          primaryIds = toIdList([r.perk0, r.perk1, r.perk2, r.perk3])
          secondaryIds = toIdList([r.perk4, r.perk5])
          statIds = toIdList([r.statPerk0, r.statPerk1, r.statPerk2])
        }

        // 单个 9 长度列表: 前 4 主系 + 2 副系 + 3 属性碎片
        if (primaryIds.length >= 9 && secondaryIds.length === 0) {
          const all = primaryIds
          primaryIds = all.slice(0, 4)
          secondaryIds = all.slice(4, 6)
          statIds = all.slice(6, 9)
        }

        if (primaryIds.length < 4 || secondaryIds.length < 2) {
          console.warn('[LOL.PS] 符文条目字段无法识别, 已跳过:', r)
          return
        }

        let primaryPageId = toNumber(
          pickField(r, [
            'mainRuneStyle',
            'mainStyleId',
            'mainRuneCategoryId',
            'primaryStyleId',
            'primaryPageId',
            'perkPrimaryStyle',
            'mainRuneCategory'
          ])
        )
        let secondaryPageId = toNumber(
          pickField(r, [
            'subRuneStyle',
            'subStyleId',
            'subRuneCategoryId',
            'secondaryStyleId',
            'secondaryPageId',
            'perkSubStyle',
            'subRuneCategory'
          ])
        )

        // 接口没给系别时, 用符文 id 反查
        if (!primaryPageId) {
          primaryPageId = RUNE_TO_STYLE[primaryIds[0]]
        }
        if (!secondaryPageId) {
          secondaryPageId = RUNE_TO_STYLE[secondaryIds[0]]
        }
        if (!primaryPageId || !secondaryPageId) {
          console.warn('[LOL.PS] 无法确定符文系别, 已跳过:', r)
          return
        }

        const play = toNumber(pickField(r, ['count', 'play', 'games'])) ?? 0
        const winRate = toRate(pickField(r, ['winRate', 'win_rate']))
        const pickRate = toRate(pickField(r, ['pickRate', 'pick_rate']))

        out.push({
          id: index,
          primary_page_id: primaryPageId,
          primary_rune_ids: primaryIds.slice(0, 4),
          secondary_page_id: secondaryPageId,
          secondary_rune_ids: secondaryIds.slice(0, 2),
          stat_mod_ids: statIds.slice(0, 3),
          play,
          win_rate: winRate,
          pick_rate: pickRate
        })
      } catch (error) {
        console.warn('[LOL.PS] 解析符文条目失败, 已跳过:', r, error)
      }
    })

    return out
  }

  private _extractSpellsAndItems(raw: any): {
    summonerSpells: OpggLikeCombEntry[]
    starterItems: OpggLikeCombEntry[]
    boots: OpggLikeCombEntry[]
    coreItems: OpggLikeCombEntry[]
    lastItems: OpggLikeCombEntry[]
  } {
    const summonerSpells: OpggLikeCombEntry[] = []
    const starterItems: OpggLikeCombEntry[] = []
    const boots: OpggLikeCombEntry[] = []
    const coreItems: OpggLikeCombEntry[] = []
    const lastItems: OpggLikeCombEntry[] = []

    if (!raw) {
      return { summonerSpells, starterItems, boots, coreItems, lastItems }
    }

    const toComb = (entry: any, idKeys: string[]): OpggLikeCombEntry | null => {
      const ids = toIdList(pickField(entry, idKeys))
      if (!ids.length) {
        return null
      }
      const play = toNumber(pickField(entry, ['count', 'play', 'games'])) ?? 0
      const winRate = toRate(pickField(entry, ['winRate', 'win_rate']))
      return {
        ids,
        play,
        win_rate: winRate,
        pick_rate: toRate(pickField(entry, ['pickRate', 'pick_rate']))
      }
    }

    const ITEM_ID_KEYS = ['itemIds', 'itemIdList', 'ids', 'items', 'itemList', 'itemId']
    const SPELL_ID_KEYS = [
      'spellIds',
      'spellIdList',
      'summonerSpellIds',
      'ids',
      'spells',
      'spellList'
    ]

    const routeItemEntry = (entry: any, categoryHint?: string) => {
      const category = String(
        categoryHint ?? pickField(entry, ['category', 'type', 'itemType', 'position']) ?? ''
      )
      const comb = toComb(entry, ITEM_ID_KEYS)
      if (!comb) {
        return
      }
      if (/start|시작/i.test(category)) {
        starterItems.push(comb)
      } else if (/shoe|boot|신발/i.test(category)) {
        boots.push(comb)
      } else if (/core|mythic|코어/i.test(category)) {
        coreItems.push(comb)
      } else if (/last|final|late|4|5|6/i.test(category)) {
        lastItems.push(comb)
      } else if (comb.ids.length >= 3) {
        coreItems.push(comb) // 三件套默认当作核心装组合
      } else {
        lastItems.push(comb)
      }
    }

    // ---- 主路径（实测 2026-08-26 结构）：
    //      itemWinrates: starting(套装,嵌套 idList) / shoes / till2..till6(前N件成套) / th1..th5(第N件单件)
    //      spellWinrates: 按序号键("0"...)的 { spell1Id, spell2Id } 组合 ----
    const iw = raw.itemWinrates
    const sw = raw.spellWinrates
    if ((iw && typeof iw === 'object') || (sw && typeof sw === 'object')) {
      const bySrcCount = (a: any, b: any) => (toNumber(b?.count) ?? 0) - (toNumber(a?.count) ?? 0)
      const byPlay = (a: OpggLikeCombEntry, b: OpggLikeCombEntry) => b.play - a.play
      const arr = (v: any) => (Array.isArray(v) ? v : [])

      const spellEntries = (
        Array.isArray(sw) ? sw : sw && typeof sw === 'object' ? Object.values(sw) : []
      ).filter((x: any) => x && typeof x === 'object')
      spellEntries.sort(bySrcCount)
      for (const e of spellEntries) {
        const ids =
          (e as any).spell1Id !== undefined
            ? toIdList([(e as any).spell1Id, (e as any).spell2Id])
            : toIdList(pickField(e, SPELL_ID_KEYS))
        const comb = toComb({ ...(e as any), ids }, ['ids'])
        if (comb && comb.ids.length >= 2) {
          summonerSpells.push(comb)
        }
      }

      if (iw && typeof iw === 'object') {
        for (const e of arr(iw.starting)) {
          const comb = toComb(e, ['itemIdList'])
          if (comb) {
            starterItems.push(comb)
          }
        }
        for (const e of [...arr(iw.shoes), ...arr(iw.threeTierShoes)]) {
          const comb = toComb(e, ['itemId', 'itemIdList'])
          if (comb) {
            boots.push(comb)
          }
        }
        const coreSrc =
          [iw.till3, iw.till2, iw.till4].find((a) => Array.isArray(a) && a.length) ?? []
        for (const e of coreSrc as any[]) {
          const comb = toComb(e, ['itemIdList'])
          if (comb) {
            coreItems.push(comb)
          }
        }
        const lasts = [...arr(iw.th4), ...arr(iw.th5)]
        lasts.sort(bySrcCount)
        for (const e of lasts.slice(0, 16)) {
          const comb = toComb(e, ['itemId', 'itemIdList'])
          if (comb) {
            lastItems.push(comb)
          }
        }
        starterItems.sort(byPlay)
        boots.sort(byPlay)
        coreItems.sort(byPlay)
      }

      if (
        summonerSpells.length ||
        starterItems.length ||
        boots.length ||
        coreItems.length ||
        lastItems.length
      ) {
        return { summonerSpells, starterItems, boots, coreItems, lastItems }
      }
    }

    // ---- 兜底：旧启发式（站点未来改版时兜住） ----
    // 形态 A: 一个统一列表, 条目自带 category 字段
    // 形态 B: 按类别拆成多个数组字段 (startItemList / shoesList / coreItemList ...)
    if (typeof raw === 'object' && !Array.isArray(raw)) {
      for (const key of Object.keys(raw)) {
        const value = raw[key]
        if (!Array.isArray(value)) {
          continue
        }
        if (/spell|스펠/i.test(key)) {
          value.forEach((entry: any) => {
            // 兼容 spell1Id + spell2Id 拆分字段
            let comb = toComb(entry, SPELL_ID_KEYS)
            if (!comb && entry?.spell1Id !== undefined) {
              comb = toComb({ ...entry, ids: [entry.spell1Id, entry.spell2Id] }, ['ids'])
            }
            if (comb && comb.ids.length >= 2) {
              summonerSpells.push(comb)
            }
          })
        } else if (/item|아이템|shoe|boot|start|core/i.test(key)) {
          const bucketHint = /start/i.test(key)
            ? 'start'
            : /shoe|boot/i.test(key)
              ? 'boots'
              : /core/i.test(key)
                ? 'core'
                : /last|final|4|5|6/i.test(key)
                  ? 'last'
                  : undefined
          value.forEach((entry: any) => routeItemEntry(entry, bucketHint))
        }
      }
    } else if (Array.isArray(raw)) {
      raw.forEach((entry: any) => routeItemEntry(entry))
    }

    // 最后兜底: 若以上启发式一个都没命中 (字段命名完全对不上),
    // 取响应中任一对象数组逐条判别: 恰好 2 个 id 且全部 < 1000 视为召唤师技能组合
    // (召唤师技能 id 均为两位数, 装备 id 均 >= 1000), 其余按装备处理
    if (
      !summonerSpells.length &&
      !starterItems.length &&
      !boots.length &&
      !coreItems.length &&
      !lastItems.length
    ) {
      const generic = findArrayField(raw, [/spell|item|list|data/i])
      generic?.forEach((entry: any) => {
        let comb = toComb(entry, [...SPELL_ID_KEYS, ...ITEM_ID_KEYS])
        if (!comb && entry?.spell1Id !== undefined) {
          comb = toComb({ ...entry, ids: [entry.spell1Id, entry.spell2Id] }, ['ids'])
        }
        if (!comb) {
          return
        }
        if (comb.ids.length === 2 && comb.ids.every((id) => id > 0 && id < 1000)) {
          summonerSpells.push(comb)
        } else {
          routeItemEntry(entry)
        }
      })
    }

    return { summonerSpells, starterItems, boots, coreItems, lastItems }
  }

  private _extractSkills(raw: any): any[] {
    if (!raw) {
      return []
    }
    const list = findArrayField(raw, [/skill|mastery/i]) ?? (Array.isArray(raw) ? raw : [])
    const out: any[] = []

    /** "QEW" / "Q>E>W" / "Q,E,W" / ['Q','E','W'] / [81,82,...] 等 → 大写字母序列 */
    const parseLetters = (v: any): string[] => {
      if (Array.isArray(v)) {
        return v.map((x) => String(x).toUpperCase()).filter((c) => /^[QWER]$/.test(c))
      }
      if (typeof v === 'string') {
        return v
          .toUpperCase()
          .split('')
          .filter((c) => 'QWER'.includes(c))
      }
      return []
    }

    // ── 主路径: lol.ps skill.json 实测结构 (2026-08-26 抓包确认) ──────────
    // { data: { master: [{ skillNameList: ['Q','W','E'], count, winRate, pickRate }],
    //           lv15:   [{ skillNameList: [15 个字母的完整加点序列], count, ... }],
    //           lv1 / lv3 / lv6 / lv11: 同形状的前 N 级序列 (不使用) } }
    const d = raw?.data ?? raw

    /** 优先按加点数，再按最后一次升级先后判断主升；不能用一级学谁来打破五点技能的平局。 */
    const priorityOf = (seq: string[], skills: string[]): string => {
      const count: Record<string, number> = {}
      const lastIndex: Record<string, number> = {}
      seq.forEach((c, i) => {
        if (!skills.includes(c)) {
          return
        }
        count[c] = (count[c] ?? 0) + 1
        lastIndex[c] = i
      })
      return Object.keys(count)
        .sort((a, b) => count[b] - count[a] || lastIndex[a] - lastIndex[b])
        .join('')
    }

    if (Array.isArray(d?.master) && d.master.length) {
      const fullSeqs = (Array.isArray(d?.lv15) ? d.lv15 : [])
        .map((e: any) => ({
          order: parseLetters(e?.skillNameList),
          play: toNumber(e?.count) ?? 0,
          win_rate: toRate(e?.winRate),
          pick_rate: toRate(e?.pickRate)
        }))
        .filter((build: any) => build.order.length === 15 && build.win_rate !== null)
        .sort((a: any, b: any) => b.play - a.play)

      const primary: any[] = []
      const masters = [...d.master].sort(
        (a: any, b: any) => (toNumber(b?.count) ?? 0) - (toNumber(a?.count) ?? 0)
      )
      const priorities = masters.map((m: any) => parseLetters(m?.skillNameList))
      masters.forEach((m: any) => {
        const ids = parseLetters(m?.skillNameList)
        if (ids.length < 2) {
          return
        }
        // 只关联主升顺序相符的逐级方案，且保留两类样本各自的统计。
        const key = ids.join('')
        const builds = fullSeqs.filter(
          (build: any) =>
            priorityOf(build.order, ids) === key &&
            // 如乌迪尔，15 级序列可能尚无法区分最后主升哪个技能；歧义时不硬配。
            priorities.filter(
              (candidate) => priorityOf(build.order, candidate) === candidate.join('')
            ).length === 1
        )
        const winRate = toRate(m?.winRate)
        if (winRate === null) return
        primary.push({
          ids,
          builds,
          play: toNumber(m?.count) ?? 0,
          win_rate: winRate,
          pick_rate: toRate(m?.pickRate)
        })
      })
      if (primary.length) {
        return primary
      }
    }

    // ── 兜底: 站点改版后走启发式识别 (主路径未命中才会到这里) ─────────────
    list.forEach((s: any) => {
      try {
        // 15 级完整加点序列 (可能不存在)
        const fullSeq = parseLetters(
          pickField(s, [
            'skillDetail',
            'skillDetailList',
            'detail',
            'sequence',
            'skillList',
            'skillOrder',
            'order'
          ])
        )

        // 主升顺序: 优先取显式的 mastery 字段
        let ids = parseLetters(
          pickField(s, ['mastery', 'masteryList', 'skillMastery', 'masteryOrder', 'ids'])
        ).slice(0, 3)

        // 没有显式主升顺序时, 按完整加点里各技能的加点次数推导 (R 不参与主升排序)
        if (ids.length < 2 && fullSeq.length >= 6) {
          const count: Record<string, number> = {}
          const firstIndex: Record<string, number> = {}
          fullSeq.forEach((c, i) => {
            if (c === 'R') {
              return
            }
            count[c] = (count[c] ?? 0) + 1
            if (firstIndex[c] === undefined) {
              firstIndex[c] = i
            }
          })
          ids = Object.keys(count)
            .sort((a, b) => count[b] - count[a] || firstIndex[a] - firstIndex[b])
            .slice(0, 3)
        }
        if (ids.length < 2) {
          return
        }

        const order = fullSeq.length >= 6 ? fullSeq : []

        const play = toNumber(pickField(s, ['count', 'play', 'games'])) ?? 0
        const winRate = toRate(pickField(s, ['winRate', 'win_rate']))
        const pickRate = toRate(pickField(s, ['pickRate', 'pick_rate']))

        out.push({
          ids,
          builds: order.length ? [{ order, play, win_rate: winRate, pick_rate: pickRate }] : [],
          play,
          win_rate: winRate,
          pick_rate: pickRate
        })
      } catch (error) {
        console.warn('[LOL.PS] 解析技能加点失败, 已跳过:', s, error)
      }
    })

    return out
  }

  private _extractCounters(raw: any): OpggLikeCounter[] {
    if (!raw) {
      return []
    }

    // ── 主路径: lol.ps versus.json 实测结构 (2026-08-26 抓包确认) ─────────
    // { data: { counterChampionIdList: [...],
    //           counterWinrateList: [数字百分比, 升序 = 我方最被克制的排最前],
    //           counterCountList: [...], counterPickrateList: [...] } } 四条平行数组
    const vsData = raw?.data ?? raw
    const vsIds: unknown[] = Array.isArray(vsData?.counterChampionIdList)
      ? vsData.counterChampionIdList
      : []
    if (vsIds.length) {
      const winList = Array.isArray(vsData?.counterWinrateList) ? vsData.counterWinrateList : []
      const countList = Array.isArray(vsData?.counterCountList) ? vsData.counterCountList : []
      return vsIds
        .flatMap((value, i) => {
          const championId = toNumber(value)
          const play = toNumber(countList[i]) ?? 0
          const winRate = toRate(winList[i])
          if (!championId || play <= 0 || winRate === null) return []
          return [{ champion_id: championId, play, win_rate: winRate }]
        })
        .sort((a, b) => b.play - a.play)
        .slice(0, 50)
    }

    // ── 兜底: 站点改版后走启发式识别 (主路径未命中才会到这里) ─────────────
    const list = findArrayField(raw, [/versus|counter|list/i]) ?? (Array.isArray(raw) ? raw : [])
    const out: OpggLikeCounter[] = []

    list.forEach((v: any) => {
      const championId = toNumber(
        pickField(v, [
          'championId',
          'champion_id',
          'enemyChampionId',
          'vsChampionId',
          'targetChampionId'
        ])
      )
      if (championId === undefined) {
        return
      }
      const play = toNumber(pickField(v, ['count', 'play', 'games'])) ?? 0
      const winRate = toRate(pickField(v, ['winRate', 'win_rate']))
      out.push({
        champion_id: championId,
        play,
        win_rate: winRate
      })
    })

    // 与 OP.GG 的 counters 语义一致: 展示我方视角胜率, 由组件自行排序
    return out.sort((a, b) => b.play - a.play).slice(0, 50)
  }
}
