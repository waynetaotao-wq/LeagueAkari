import type { AxiosInstance } from 'axios'

import type {
  MatchupBuildEntry,
  MatchupBuildSection,
  MatchupRunePage
} from '@shared/types/counter-intel'
import type { LaneName } from '@shared/utils/lane-assignment'

import {
  OPGG_WEB_BASE,
  POSITION_TO_WEB_SEGMENT,
  WEB_REQUEST_HEADERS,
  toWebRegion,
  toWebTier
} from './counter-intel-web'

/**
 * [lolps] 对位构筑（Matchup Build）—— OP.GG 网页数据通道（纯逻辑模块）
 *
 * OP.GG 的 build 页支持 `?target_champion={对手slug}` 参数（网页顶部 "vs." 筛选器），
 * 返回「我的英雄 × 对位英雄」的专属构筑：符文页、召唤师技能、起始装、鞋、
 * 核心三件组合（各带组合胜率）、第 4/5 件选装。该数据官方 JSON 接口不提供
 * （2026-08 逐参数核实），因此走网页抓取。
 *
 * ⚠ 站点改版防护（与 counter-intel-web 同门风格）：
 *   1. 数据以「图标 URL + 邻近统计对象」为主线提取，最大限度不依赖具体字段名
 *   2. 符文块走独立 JSON 平衡提取（"rune_pages" 数组在流里是干净 JSON）
 *   3. 全部可变点集中在下方「可调区」；整体失败时 pageParsed=false，
 *      渲染端显示"对位构筑暂不可用"，克制表功能不受影响
 */

// ==================================================================
// ======================== 可调区（集中配置） ========================
// ==================================================================

/** 各区块在页面流里的标题锚点（请求固定 Accept-Language: en）。按页面出现顺序排列。 */
export const SECTION_ANCHORS: ReadonlyArray<{
  key: MatchupBuildSection['key']
  labels: readonly string[]
}> = [
  { key: 'spells', labels: ['Summoner spells'] },
  { key: 'starter', labels: ['Starter items'] },
  { key: 'boots', labels: ['Boots'] },
  { key: 'core', labels: ['Core builds'] },
  { key: 'item4', labels: ['Fourth Item'] },
  { key: 'item5', labels: ['Fifth Item'] }
]

/** 段落终止锚点（最后一段扫到此为止，避免吞进 Counter 区） */
export const SECTION_TAIL_ANCHORS: readonly string[] = ['Weak against', 'Counter', 'Synergies']

/** 统计对象探测：play 与 win_rate/pick_rate 相邻出现（键序不定，取宽松式） */
const STATS_RE =
  /\{"play":(\d+)(?:,"win":(\d+))?(?:[^{}]{0,120}?"pick_rate":([\d.]+))?(?:[^{}]{0,120}?"win_rate":([\d.]+))?[^{}]*\}/g

/** 图标 URL 探测（OP.GG CDN） */
const ITEM_IMG_RE = /https:\/\/[a-z0-9.-]*(?:akamaized|op\.gg)[^"'\s]*\/item\/(\d+)\.png[^"'\s]*/g
const SPELL_IMG_RE =
  /https:\/\/[a-z0-9.-]*(?:akamaized|op\.gg)[^"'\s]*\/spell\/([A-Za-z0-9_]+)\.png[^"'\s]*/g
const RUNE_IMG_RE =
  /https:\/\/[a-z0-9.-]*(?:akamaized|op\.gg)[^"'\s]*\/(?:perk|perkStyle|perkShard)\/[^"'\s]+\.png[^"'\s]*/g

/** 召唤师技能图标名 → LCU 技能 id（多年稳定的固定映射） */
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

/** 符文细分：样式（主/副系图）、符文颗、属性碎片 */
const RUNE_STYLE_ID_RE = /\/perkStyle\/(\d+)\.png/g
const RUNE_PERK_ID_RE = /\/perk\/(\d+)\.png/g
const RUNE_SHARD_ID_RE = /\/(?:perkShard|statMods?|statmods?)\/(\d+)\.png/g

/** 每段最多收多少条目（防解析跑飞） */
const MAX_ENTRIES_PER_SECTION = 8

// ==================================================================
// ============================ 工具函数 =============================
// ==================================================================

/** 剥掉多层反斜杠转义（HTML/RSC 流中 JSON 被一到多层转义） */
export function stripEscapes(text: string): string {
  return text.replace(/\\+"/g, '"')
}

/** 从 pos 处（应指向 '[' 或 '{'）提取配平的 JSON 片段；失败返回 null */
export function extractBalanced(text: string, pos: number): string | null {
  const open = text[pos]
  if (open !== '[' && open !== '{') return null
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inStr = false
  for (let i = pos; i < text.length && i - pos < 400_000; i++) {
    const ch = text[i]
    if (inStr) {
      if (ch === '\\') {
        i++
      } else if (ch === '"') {
        inStr = false
      }
      continue
    }
    if (ch === '"') {
      inStr = true
    } else if (ch === open || (open === '[' && ch === '{') || (open === '{' && ch === '[')) {
      depth++
    } else if (ch === close || (open === '[' && ch === '}') || (open === '{' && ch === ']')) {
      depth--
      if (depth === 0) {
        return text.slice(pos, i + 1)
      }
    }
  }
  return null
}

function collectMatches(re: RegExp, text: string): Array<{ index: number; match: RegExpExecArray }> {
  const out: Array<{ index: number; match: RegExpExecArray }> = []
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    out.push({ index: m.index, match: m })
    if (out.length > 400) break
  }
  return out
}

function toNum(v: string | undefined): number | null {
  if (v === undefined) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

// ==================================================================
// ============================ 页面抓取 =============================
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

// ==================================================================
// ============================ 三路解析 =============================
// ==================================================================

/** 路线一：符文页（干净 JSON 平衡提取，两套：最常用 / 最高胜率） */
export function parseRunePages(clean: string): MatchupRunePage[] {
  const anchor = '"rune_pages":'
  let from = 0
  while (true) {
    const i = clean.indexOf(anchor, from)
    if (i < 0) return []
    const arrStart = clean.indexOf('[', i + anchor.length)
    if (arrStart < 0) return []
    // 跳过 i18n 文案表（其值是字符串而非数组对象）
    const probe = clean.slice(i, arrStart + 2)
    if (!probe.includes('[{')) {
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
      if (!Array.isArray(pages) || pages.length === 0) {
        from = i + anchor.length
        continue
      }
      const out: MatchupRunePage[] = []
      for (const page of pages.slice(0, 2)) {
        const builds: any[] = Array.isArray(page?.builds) ? page.builds : []
        const primary = builds[0] ?? page
        const styleName =
          primary?.primary_perk_style?.name ?? page?.primary_perk_style?.name ?? null
        const rawJson = JSON.stringify(primary)
        const imageUrls = [
          ...new Set(collectMatches(RUNE_IMG_RE, rawJson).map((r) => r.match[0]))
        ].slice(0, 14)

        // —— 结构化提取（一键置入用）：字段名候选优先，图标 URL 解析兜底 ——
        const idsFrom = (re: RegExp): number[] => {
          const seen = new Set<number>()
          const list: number[] = []
          for (const r of collectMatches(re, rawJson)) {
            const n = toNum(r.match[1])
            if (n !== null && !seen.has(n)) {
              seen.add(n)
              list.push(n)
            }
          }
          return list
        }
        const asNumArr = (v: unknown): number[] =>
          Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : []

        const styleIds = idsFrom(RUNE_STYLE_ID_RE)
        const perkIds = idsFrom(RUNE_PERK_ID_RE)
        const shardIds = idsFrom(RUNE_SHARD_ID_RE)

        const primaryStyleId: number | null =
          (typeof primary?.primary_page_id === 'number' ? primary.primary_page_id : null) ??
          (typeof primary?.primary_perk_style?.id === 'number'
            ? primary.primary_perk_style.id
            : null) ??
          styleIds[0] ??
          null
        const secondaryStyleId: number | null =
          (typeof primary?.secondary_page_id === 'number' ? primary.secondary_page_id : null) ??
          (typeof primary?.secondary_perk_style?.id === 'number'
            ? primary.secondary_perk_style.id
            : null) ??
          styleIds[1] ??
          null
        let primaryRuneIds = asNumArr(primary?.primary_rune_ids)
        let secondaryRuneIds = asNumArr(primary?.secondary_rune_ids)
        if (primaryRuneIds.length !== 4 || secondaryRuneIds.length !== 2) {
          if (perkIds.length >= 6) {
            primaryRuneIds = perkIds.slice(0, 4)
            secondaryRuneIds = perkIds.slice(4, 6)
          }
        }
        let statShardIds = asNumArr(primary?.stat_mod_ids)
        if (statShardIds.length !== 3 && shardIds.length >= 3) {
          statShardIds = shardIds.slice(0, 3)
        }

        const structured =
          primaryStyleId !== null &&
          secondaryStyleId !== null &&
          primaryRuneIds.length === 4 &&
          secondaryRuneIds.length === 2 &&
          statShardIds.length === 3
            ? { primaryStyleId, secondaryStyleId, primaryRuneIds, secondaryRuneIds, statShardIds }
            : null

        out.push({
          styleName: typeof styleName === 'string' ? styleName : null,
          play: typeof page?.play === 'number' ? page.play : null,
          pickRate: typeof page?.pick_rate === 'number' ? page.pick_rate : null,
          imageUrls,
          structured,
          raw: primary
        })
      }
      return out
    } catch {
      from = i + anchor.length
    }
  }
}

/** 路线二：按标题锚点分段，段内以「统计对象 + 前方图标序列」组装条目 */
export function parseSections(clean: string): MatchupBuildSection[] {
  // 定位各段起点（lastIndexOf 优先取渲染树处，避开文件前部的 i18n 定义表）
  const positions: Array<{ key: MatchupBuildSection['key']; pos: number }> = []
  for (const { key, labels } of SECTION_ANCHORS) {
    let best = -1
    for (const label of labels) {
      const p = clean.lastIndexOf(`"${label}"`)
      if (p > best) best = p
    }
    if (best >= 0) positions.push({ key, pos: best })
  }
  positions.sort((a, b) => a.pos - b.pos)
  if (positions.length === 0) return []

  let tail = clean.length
  for (const t of SECTION_TAIL_ANCHORS) {
    const p = clean.indexOf(`"${t}"`, positions[positions.length - 1].pos + 1)
    if (p > 0 && p < tail) tail = p
  }

  const sections: MatchupBuildSection[] = []
  for (let s = 0; s < positions.length; s++) {
    const { key, pos } = positions[s]
    const end = s + 1 < positions.length ? positions[s + 1].pos : tail
    const seg = clean.slice(pos, end)

    const stats = collectMatches(STATS_RE, seg)
    const imgRe = key === 'spells' ? SPELL_IMG_RE : ITEM_IMG_RE
    const imgs = collectMatches(imgRe, seg)

    const entries: MatchupBuildEntry[] = []
    let prevStatEnd = 0
    for (const st of stats) {
      if (entries.length >= MAX_ENTRIES_PER_SECTION) break
      const statStart = st.index
      const groupImgs = imgs.filter((im) => im.index > prevStatEnd && im.index < statStart)
      prevStatEnd = statStart + st.match[0].length
      if (groupImgs.length === 0) continue
      const seen = new Set<string>()
      const imageUrls: string[] = []
      const itemIds: number[] = []
      for (const im of groupImgs) {
        const url = im.match[0]
        if (seen.has(url)) continue
        seen.add(url)
        imageUrls.push(url)
        if (key === 'spells') {
          const token = im.match[1] ?? ''
          const sid = /^\d+$/.test(token) ? Number(token) : SPELL_NAME_TO_ID[token]
          if (typeof sid === 'number' && Number.isFinite(sid)) itemIds.push(sid)
        } else {
          const id = toNum(im.match[1])
          if (id !== null) itemIds.push(id)
        }
        if (imageUrls.length >= 4) break
      }
      entries.push({
        imageUrls,
        itemIds,
        play: toNum(st.match[1]),
        win: toNum(st.match[2]),
        pickRate: toNum(st.match[3]),
        winRate: toNum(st.match[4])
      })
    }

    if (entries.length > 0) {
      sections.push({ key, entries })
    }
  }
  return sections
}

// ==================================================================
// ============================ 对外主函数 ============================
// ==================================================================

export async function fetchMatchupPage(
  web: AxiosInstance,
  url: string,
  signal?: AbortSignal
): Promise<{ runePages: MatchupRunePage[]; sections: MatchupBuildSection[] }> {
  const res = await web.get<string>(url, {
    headers: { ...WEB_REQUEST_HEADERS },
    responseType: 'text',
    transformResponse: [(data) => data],
    signal
  })
  const clean = stripEscapes(typeof res.data === 'string' ? res.data : String(res.data ?? ''))
  return {
    runePages: parseRunePages(clean),
    sections: parseSections(clean)
  }
}
