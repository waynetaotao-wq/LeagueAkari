/**
 * [lolps] Bz（欧服第一劫）对线攻略表接入
 *
 * 数据源：公开 Google Sheets 的 CSV 导出端点（无需认证，永远指向表的当前最新版，
 * 作者更新表格后本端点内容随之变化——配合短 TTL 缓存即实现"自动跟更"）。
 * 结构：每行一个对线英雄（英文名），列含符文 / 难度 / 核心装 / 打法要点。
 */
import axios from 'axios'

// ============================ 可调区 ============================

/** 表文档 id 与工作表 gid（作者若开新表页在此更新） */
export const BZ_SHEET_ID = '1FInDZ2JhIyto2y-FnCcgCVlAYcjRaF7egcpsV41Spic'
export const BZ_SHEET_GID = '1026317672'
/** 缓存时长：过期后下次查询重拉（作者更新表后最迟此时长内生效） */
export const BZ_CACHE_TTL = 10 * 60 * 1000
/** 该攻略仅对此英雄生效（劫） */
export const BZ_MY_CHAMPION_ID = 238

export const BZ_CSV_URL = `https://docs.google.com/spreadsheets/d/${BZ_SHEET_ID}/export?format=csv&gid=${BZ_SHEET_GID}`

// ============================ 类型 ==============================

export interface BzMatchupRow {
  /** 表内英雄英文名（原文） */
  champion: string
  rune: string
  difficulty: string
  coreBuild: string
  summary: string
  /** 核心装解析为官方 itemId 序列（≥2 件成功才给；用于置顶覆盖原生核心装区） */
  coreItemIds?: number[]
  /** Bz 推荐基石 perkId（用于筛选 OP.GG 对位符文页；无法识别为 null） */
  keystonePerkId: number | null
}

// ==================== 装备名 → itemId（Data Dragon 英文库） ====================

/** 常见缩写别名（归一名 → 装备全名归一名） */
const ITEM_ALIASES: Record<string, string> = {
  ldr: 'lorddominiksregards',
  serpents: 'serpentsfang',
  botrk: 'bladeoftheruinedking',
  seryldas: 'seryldasgrudge'
}

/** 装备名映射缓存（Data Dragon 更新慢，长 TTL） */
const ITEM_MAP_TTL = 6 * 60 * 60 * 1000
let _itemMapCache: { expiresAt: number; byName: Map<string, number> } | null = null

async function ensureItemNameMap(): Promise<Map<string, number>> {
  const now = Date.now()
  if (_itemMapCache && _itemMapCache.expiresAt > now) {
    return _itemMapCache.byName
  }
  const versions = await axios.get<string[]>('https://ddragon.leagueoflegends.com/api/versions.json', {
    timeout: 12000
  })
  const ver = Array.isArray(versions.data) && versions.data[0] ? versions.data[0] : null
  if (!ver) throw new Error('no ddragon version')
  const items = await axios.get<any>(
    `https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/item.json`,
    { timeout: 15000 }
  )
  const byName = new Map<string, number>()
  const data = items.data?.data ?? {}
  for (const [idStr, info] of Object.entries<any>(data)) {
    const id = Number(idStr)
    const nm = normalizeName(info?.name ?? '')
    if (!nm || !Number.isFinite(id)) continue
    // 同名以更大 id（通常为当前版本变体）为准
    const prev = byName.get(nm)
    if (prev === undefined || id > prev) byName.set(nm, id)
  }
  _itemMapCache = { expiresAt: now + ITEM_MAP_TTL, byName }
  return byName
}

/** 单个装备名 → id：精确 → 别名 → 前缀（≥4 字符且唯一） */
export function resolveItemName(raw: string, byName: Map<string, number>): number | null {
  const n0 = normalizeName(raw)
  if (!n0) return null
  const n = ITEM_ALIASES[n0] ?? n0
  const exact = byName.get(n)
  if (exact !== undefined) return exact
  if (n.length < 4) return null
  const hits: number[] = []
  for (const [name, id] of byName) {
    if (name.startsWith(n)) hits.push(id)
  }
  return hits.length === 1 ? hits[0] : null
}

/** 核心装文字链（"Voltaic→ Bastion→ LDR"）→ itemId 序列（跳过无法解析的段） */
export function resolveBuildItems(coreBuild: string, byName: Map<string, number>): number[] {
  const out: number[] = []
  for (const seg of (coreBuild || '').split(/→|->|>/)) {
    const id = resolveItemName(seg.trim(), byName)
    if (id !== null && !out.includes(id)) out.push(id)
  }
  return out
}

// ============================ CSV 解析 ==========================

/** 标准 CSV 解析（支持引号包裹的换行与转义引号） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
    } else if (ch === ',') {
      row.push(field)
      field = ''
    } else if (ch === '\n') {
      row.push(field)
      field = ''
      rows.push(row)
      row = []
    } else if (ch === '\r') {
      // 忽略（\r\n 序列由 \n 收行）
    } else {
      field += ch
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/** 名字归一：小写并去除全部非字母数字（Kha'Zix → khazix、Dr. Mundo → drmundo） */
export function normalizeName(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** 基石符文英文名 → perkId（可调区：新基石在此追加；含常见缩写） */
export const KEYSTONE_MAP: Record<string, number> = {
  presstheattack: 8005,
  lethaltempo: 8008,
  fleetfootwork: 8021,
  conqueror: 8010,
  conq: 8010,
  electrocute: 8112,
  darkharvest: 8128,
  hailofblades: 9923,
  summonaery: 8214,
  aery: 8214,
  arcanecomet: 8229,
  phaserush: 8230,
  graspoftheundying: 8437,
  grasp: 8437,
  aftershock: 8439,
  guardian: 8465,
  glacialaugment: 8351,
  unsealedspellbook: 8360,
  firststrike: 8369
}

/** 从 Bz 符文列文字里解析基石 perkId（逐行归一后查映射，命中首个；无法识别返回 null） */
export function parseKeystone(runeText: string): number | null {
  for (const line of (runeText || '').split('\n')) {
    const n = normalizeName(line)
    if (!n) continue
    if (KEYSTONE_MAP[n] !== undefined) return KEYSTONE_MAP[n]
  }
  // 整段兜底（"First Strike Precision" 单行书写的情况）
  const whole = normalizeName(runeText)
  for (const [name, id] of Object.entries(KEYSTONE_MAP)) {
    if (name.length >= 4 && whole.startsWith(name)) return id
  }
  return null
}

/** 少数表名与 OP.GG slug 不同源的别名（归一后比对） */
const NAME_ALIASES: Record<string, string> = {
  monkeyking: 'wukong'
}

export function canonicalName(name: string): string {
  const n = normalizeName(name)
  return NAME_ALIASES[n] ?? n
}

/** 从整表行中解析出对线攻略行（自动定位表头行，对列名不敏感于大小写与空白） */
export function extractBzRows(rows: string[][]): BzMatchupRow[] {
  const headerIdx = rows.findIndex((r) => {
    const low = r.map((c) => (c || '').trim().toLowerCase())
    return low.includes('champion') && low.includes('difficulty')
  })
  if (headerIdx < 0) return []
  const header = rows[headerIdx].map((c) => (c || '').trim().toLowerCase())
  const col = (name: string) => header.findIndex((h) => h.includes(name))
  const cChampion = col('champion')
  const cRune = col('rune')
  const cDifficulty = col('difficulty')
  const cCore = col('core build')
  const cSummary = col('summary')
  if (cChampion < 0) return []

  const out: BzMatchupRow[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const champion = (r[cChampion] ?? '').trim()
    if (!champion || normalizeName(champion).length === 0) continue
    const rune = cRune >= 0 ? (r[cRune] ?? '').trim() : ''
    out.push({
      champion,
      rune,
      difficulty: cDifficulty >= 0 ? (r[cDifficulty] ?? '').trim() : '',
      coreBuild: cCore >= 0 ? (r[cCore] ?? '').trim() : '',
      summary: cSummary >= 0 ? (r[cSummary] ?? '').trim() : '',
      keystonePerkId: parseKeystone(rune)
    })
  }
  return out
}

// ============================ 拉取与查询 ========================

let _cache: { expiresAt: number; byName: Map<string, BzMatchupRow> } | null = null

async function ensureTable(): Promise<Map<string, BzMatchupRow>> {
  const now = Date.now()
  if (_cache && _cache.expiresAt > now) {
    return _cache.byName
  }
  const { data } = await axios.get<string>(BZ_CSV_URL, {
    timeout: 12000,
    responseType: 'text'
  })
  const byName = new Map<string, BzMatchupRow>()
  for (const row of extractBzRows(parseCsv(String(data)))) {
    byName.set(canonicalName(row.champion), row)
  }
  if (byName.size > 0) {
    _cache = { expiresAt: now + BZ_CACHE_TTL, byName }
  }
  return byName
}

/**
 * 按对位英雄的 OP.GG slug（英文名同源）查 Bz 攻略行。
 * 拉取失败或未命中返回 null；缓存过期自动重拉（自动跟随表更新）。
 */
export async function getBzZedMatchup(opponentSlug: string): Promise<BzMatchupRow | null> {
  if (!opponentSlug) return null
  try {
    const table = await ensureTable()
    const key = canonicalName(opponentSlug)
    const found = table.get(key) ?? prefixLookup(table, key)
    if (!found) return null
    return await withCoreItems(found)
  } catch {
    return null
  }
}

/** 前缀兜底：表内常见缩写名（Cassio / Trynd / Twisted…），≥4 字符且唯一命中才认 */
function prefixLookup(table: Map<string, BzMatchupRow>, key: string): BzMatchupRow | null {
  const hits: BzMatchupRow[] = []
  for (const [name, row] of table) {
    if (name.length >= 4 && key.startsWith(name)) hits.push(row)
  }
  return hits.length === 1 ? hits[0] : null
}

/** 附加核心装 id 解析（≥2 件成功才提供；装备库拉取失败仅回落文字展示） */
async function withCoreItems(row: BzMatchupRow): Promise<BzMatchupRow> {
  if (!row.coreBuild) return row
  try {
    const byName = await ensureItemNameMap()
    const ids = resolveBuildItems(row.coreBuild, byName)
    if (ids.length >= 2) {
      return { ...row, coreItemIds: ids }
    }
  } catch {}
  return row
}
