import type { AxiosInstance } from 'axios'

import type { LaneName } from '@shared/utils/lane-assignment'

import {
  OPGG_WEB_BASE,
  POSITION_TO_WEB_SEGMENT,
  WEB_REQUEST_HEADERS,
  toWebRegion,
  toWebTier
} from './counter-intel-web'

/**
 * [lolps] 对位构筑 v2 —— OP.GG 网页 vs 通道 → 官方数据形状
 *
 * OP.GG 网页 build 页支持 `?target_champion={对手slug}`（顶部 "vs." 筛选器），
 * 返回「我的英雄 × 对位英雄」的专属构筑。官方 JSON 接口不含该维度（逐参数核实），
 * 因此抓网页。本模块把网页数据解析成与官方接口完全一致的形状
 * （{ids, play, win, pick_rate} 条目 / 官方 runes 元素），供渲染层整窗替换：
 * UI、每区块的"应用"按钮、自动应用全部走官方原生管道，零风格差异。
 *
 * 解析三防线（改版排障看本文件可调区）：
 *   1. 符文：流内 "rune_pages" 干净 JSON 平衡提取，isActive 标记点名选中颗
 *   2. 装备/召唤师：标题锚点分段 + 「图标序列 → 选取率% → N Games → 胜率%」文本状态机
 *   3. 任一路失败仅缺该区块，渲染层自动回落通用版数据
 */

// ==================================================================
// ======================== 可调区（集中配置） ========================
// ==================================================================

/** 官方形状条目（与 OpggChampionBuildResponse 内 build pick item 对齐） */
export interface OpggPickLike {
  ids: number[]
  play: number
  win: number
  pick_rate: number
}

/** 官方形状符文元素（与 loadout.setRunes / UI 渲染字段对齐） */
export interface OpggRuneLike {
  id: number
  primary_page_id: number
  primary_rune_ids: number[]
  secondary_page_id: number
  secondary_rune_ids: number[]
  stat_mod_ids: number[]
  play: number
  win: number
  pick_rate: number
}

/** 整窗覆盖载荷：键名与官方 data 完全一致，仅包含解析成功的区块 */
export interface MatchupOverlayData {
  summoner_spells?: OpggPickLike[]
  runes?: OpggRuneLike[]
  starter_items?: OpggPickLike[]
  boots?: OpggPickLike[]
  core_items?: OpggPickLike[]
  last_items?: OpggPickLike[]
}

/** 各区块标题锚点（请求固定英文），按页面出现顺序；哨兵段不产出仅作边界 */
const SECTION_ANCHORS: ReadonlyArray<{ key: keyof MatchupOverlayData | '_sentinel'; label: string }> =
  [
    { key: 'summoner_spells', label: 'Summoner spells' },
    { key: '_sentinel', label: 'Skill order' },
    { key: 'starter_items', label: 'Starter items' },
    { key: 'boots', label: 'Boots' },
    { key: 'core_items', label: 'Core builds' },
    { key: 'last_items', label: 'Fourth Item' },
    { key: 'last_items', label: 'Fifth Item' }
  ]

/** 段落终止锚点（吞到 Counter/协同区之前为止） */
const TAIL_ANCHORS: readonly string[] = ['Weak against', 'Strong against', 'Counter', 'Synergies', 'mastery ranking']

/** 召唤师技能图标名 → LCU 技能 id（多年稳定映射） */
export const SPELL_NAME_TO_ID: Readonly<Record<string, number>> = {
  SummonerFlash: 4,
  SummonerDot: 14,
  SummonerHaste: 6,
  SummonerHeal: 7,
  SummonerTeleport: 12,
  SummonerExhaust: 3,
  SummonerBarrier: 21,
  SummonerBoost: 1,
  SummonerSmite: 11,
  SummonerMana: 13,
  SummonerSnowball: 32
}

/** 每段最多条目数（防解析跑飞） */
const MAX_ENTRIES = 8

// token 正则（清洗后的流；文本节点带双引号）
const IMG_RE = /\/(item)\/(\d+)\.png|\/spell\/([A-Za-z0-9_]+)\.png/g
const PCT_RE = /"(\d{1,3}(?:\.\d+)?)%"/g
const GAMES_RE = /"([\d,]+) Games?"/g

// 符文细分
const RUNE_STYLE_ID_RE = /\/perkStyle\/(\d+)\.png/g
const RUNE_PERK_ID_RE = /\/perk\/(\d+)\.png/g
const RUNE_SHARD_ID_RE = /\/(?:perkShard|statMods?|statmods?)\/(\d+)\.png/g

// ==================================================================
// ============================ 工具函数 =============================
// ==================================================================

export function stripEscapes(text: string): string {
  return text.replace(/\\+"/g, '"')
}

/** 从 pos（指向 '[' 或 '{'）提取配平 JSON 片段 */
export function extractBalanced(text: string, pos: number): string | null {
  const open = text[pos]
  if (open !== '[' && open !== '{') return null
  let depth = 0
  let inStr = false
  for (let i = pos; i < text.length && i - pos < 400_000; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') i++
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) return text.slice(pos, i + 1)
    }
  }
  return null
}

interface Tok {
  index: number
  kind: 'img' | 'pct' | 'games'
  value: number
  spellName?: string
}

function scanTokens(seg: string): Tok[] {
  const toks: Tok[] = []
  let m: RegExpExecArray | null
  IMG_RE.lastIndex = 0
  while ((m = IMG_RE.exec(seg))) {
    if (m[2]) toks.push({ index: m.index, kind: 'img', value: Number(m[2]) })
    else if (m[3]) toks.push({ index: m.index, kind: 'img', value: NaN, spellName: m[3] })
    if (toks.length > 600) break
  }
  PCT_RE.lastIndex = 0
  while ((m = PCT_RE.exec(seg))) {
    toks.push({ index: m.index, kind: 'pct', value: Number(m[1]) })
    if (toks.length > 900) break
  }
  GAMES_RE.lastIndex = 0
  while ((m = GAMES_RE.exec(seg))) {
    toks.push({ index: m.index, kind: 'games', value: Number(m[1].replace(/,/g, '')) })
    if (toks.length > 1200) break
  }
  toks.sort((a, b) => a.index - b.index)
  return toks
}

/**
 * 段内条目状态机：图标序列 → 选取率% → N Games → 胜率%。
 * spells 段图标走名字映射；模式断裂即丢弃半成品，绝不拼错误条目。
 */
function assembleEntries(seg: string, isSpells: boolean): OpggPickLike[] {
  const toks = scanTokens(seg)
  const out: OpggPickLike[] = []
  let ids: number[] = []
  let pending: { ids: number[]; pick: number; play?: number } | null = null

  for (const tk of toks) {
    if (out.length >= MAX_ENTRIES) break
    if (tk.kind === 'img') {
      if (pending && pending.play === undefined) pending = null
      let id: number | null = null
      if (isSpells) {
        const sid = tk.spellName ? SPELL_NAME_TO_ID[tk.spellName] : Number.isFinite(tk.value) ? tk.value : null
        if (typeof sid === 'number' && Number.isFinite(sid)) id = sid
      } else if (Number.isFinite(tk.value)) {
        id = tk.value
      }
      if (id !== null && ids.length < 6 && !ids.includes(id)) ids.push(id)
    } else if (tk.kind === 'pct') {
      if (pending && pending.play !== undefined) {
        // 第二个百分比 = 胜率，条目完成
        const winRate = tk.value / 100
        const entry: OpggPickLike = {
          ids: pending.ids,
          play: pending.play,
          win: Math.round(pending.play * winRate),
          pick_rate: Math.round(pending.pick * 100) / 10000
        }
        if (entry.ids.length > 0 && (!isSpells || entry.ids.length === 2)) out.push(entry)
        pending = null
      } else if (ids.length > 0) {
        pending = { ids: [...ids], pick: tk.value }
        ids = []
      }
      // 无图标前缀的散排百分比：忽略
    } else if (tk.kind === 'games') {
      if (pending && pending.play === undefined) pending.play = tk.value
      else pending = null
    }
  }
  return out
}

// ==================================================================
// ============================ 主解析 ==============================
// ==================================================================

/** 路线一：符文（干净 JSON + isActive 点名选中颗） */
export function parseRunes(clean: string): OpggRuneLike[] {
  const anchor = '"rune_pages":'
  let from = 0
  while (true) {
    const i = clean.indexOf(anchor, from)
    if (i < 0) return []
    const arrStart = clean.indexOf('[', i + anchor.length)
    if (arrStart < 0 || !clean.slice(i, arrStart + 2).includes('[{')) {
      from = i + anchor.length
      continue
    }
    const raw = extractBalanced(clean, arrStart)
    if (!raw) {
      from = i + anchor.length
      continue
    }
    try {
      const pages: any[] = JSON.parse(raw)
      if (!Array.isArray(pages) || pages.length === 0 || typeof pages[0]?.play !== 'number') {
        from = i + anchor.length
        continue
      }
      const out: OpggRuneLike[] = []
      pages.slice(0, 3).forEach((page, index) => {
        const b = (Array.isArray(page?.builds) ? page.builds[0] : null) ?? page

        const pickActive = (v: unknown): number[] => {
          const flat: any[] = Array.isArray(v) ? (v as any[]).flat(2) : []
          return flat
            .filter((u) => u && typeof u === 'object' && u.isActive === true && typeof u.id === 'number')
            .map((u) => u.id as number)
        }
        const idsFromUrls = (re: RegExp): number[] => {
          const rawJson = JSON.stringify(b)
          const list: number[] = []
          let m: RegExpExecArray | null
          re.lastIndex = 0
          while ((m = re.exec(rawJson))) {
            const n = Number(m[1])
            if (Number.isFinite(n) && !list.includes(n)) list.push(n)
          }
          return list
        }

        let primaryRuneIds = pickActive(b?.main_runes)
        let secondaryRuneIds = pickActive(b?.sub_runes)
        let statShardIds = pickActive(b?.shards)
        if (primaryRuneIds.length !== 4 || secondaryRuneIds.length !== 2) {
          const perks = idsFromUrls(RUNE_PERK_ID_RE)
          if (perks.length >= 6) {
            primaryRuneIds = perks.slice(0, 4)
            secondaryRuneIds = perks.slice(4, 6)
          }
        }
        if (statShardIds.length !== 3) {
          const shards = idsFromUrls(RUNE_SHARD_ID_RE)
          if (shards.length >= 3) statShardIds = shards.slice(0, 3)
        }

        const styleUrls = idsFromUrls(RUNE_STYLE_ID_RE)
        const primaryStyleId: number | null =
          (typeof b?.primary_perk_style?.id === 'number' ? b.primary_perk_style.id : null) ??
          styleUrls[0] ??
          null
        const secondaryStyleId: number | null =
          (typeof b?.perk_sub_style?.id === 'number' ? b.perk_sub_style.id : null) ??
          (typeof b?.secondary_perk_style?.id === 'number' ? b.secondary_perk_style.id : null) ??
          styleUrls[1] ??
          null

        if (
          primaryStyleId === null ||
          secondaryStyleId === null ||
          primaryRuneIds.length !== 4 ||
          secondaryRuneIds.length !== 2 ||
          statShardIds.length !== 3
        ) {
          return
        }

        const play = typeof page.play === 'number' ? page.play : 0
        let winRate = typeof page.win_rate === 'number' ? page.win_rate : 0
        if (winRate > 1) winRate = winRate / 100
        let pickRate = typeof page.pick_rate === 'number' ? page.pick_rate : 0
        if (pickRate > 1) pickRate = pickRate / 100

        out.push({
          id: index,
          primary_page_id: primaryStyleId,
          primary_rune_ids: primaryRuneIds,
          secondary_page_id: secondaryStyleId,
          secondary_rune_ids: secondaryRuneIds,
          stat_mod_ids: statShardIds,
          play,
          win: Math.round(play * winRate),
          pick_rate: pickRate
        })
      })
      return out
    } catch {
      from = i + anchor.length
    }
  }
}

/** 路线二：装备/召唤师（标题分段 + 文本状态机），产出官方形状各区块 */
export function parseItemSections(clean: string): Partial<MatchupOverlayData> {
  const positions: Array<{ key: keyof MatchupOverlayData | '_sentinel'; pos: number }> = []
  for (const { key, label } of SECTION_ANCHORS) {
    const p = clean.lastIndexOf(`"${label}"`)
    if (p >= 0) positions.push({ key, pos: p })
  }
  positions.sort((a, b) => a.pos - b.pos)
  if (positions.length === 0) return {}

  let tail = clean.length
  for (const t of TAIL_ANCHORS) {
    const p = clean.indexOf(`"${t}"`, positions[positions.length - 1].pos + 1)
    if (p > 0 && p < tail) tail = p
  }

  const acc: Partial<Record<keyof MatchupOverlayData, OpggPickLike[]>> = {}
  for (let s = 0; s < positions.length; s++) {
    const { key, pos } = positions[s]
    if (key === '_sentinel') continue
    const end = s + 1 < positions.length ? positions[s + 1].pos : tail
    const entries = assembleEntries(clean.slice(pos, end), key === 'summoner_spells')
    if (entries.length > 0) {
      acc[key] = [...(acc[key] ?? []), ...entries]
    }
  }
  return acc
}

// ==================================================================
// ============================ 对外主函数 ============================
// ==================================================================

export function buildMatchupPageUrl(params: {
  mySlug: string
  opponentSlug: string
  position: LaneName
  region: string
  tier: string | number
}): string {
  const seg = POSITION_TO_WEB_SEGMENT[params.position]
  const q = new URLSearchParams()
  // 与克制助手 counters 页同款（真机验证过的口径转换），region/tier 始终显式携带
  q.set('region', toWebRegion(params.region))
  q.set('tier', toWebTier(params.tier))
  q.set('target_champion', params.opponentSlug)
  return `${OPGG_WEB_BASE}/lol/champions/${params.mySlug}/build/${seg}?${q.toString()}`
}

export async function fetchMatchupOverlay(
  web: AxiosInstance,
  url: string,
  signal?: AbortSignal
): Promise<{ overlay: MatchupOverlayData; parsed: string[] }> {
  const res = await web.get<string>(url, {
    headers: { ...WEB_REQUEST_HEADERS },
    responseType: 'text',
    transformResponse: [(data) => data],
    signal
  })
  const clean = stripEscapes(typeof res.data === 'string' ? res.data : String(res.data ?? ''))

  const overlay: MatchupOverlayData = {}
  const runes = parseRunes(clean)
  if (runes.length > 0) overlay.runes = runes
  const sections = parseItemSections(clean)
  for (const [k, v] of Object.entries(sections)) {
    if (Array.isArray(v) && v.length > 0) {
      overlay[k as keyof MatchupOverlayData] = v as any
    }
  }
  return { overlay, parsed: Object.keys(overlay) }
}
