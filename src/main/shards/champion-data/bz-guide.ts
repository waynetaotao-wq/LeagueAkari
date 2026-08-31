/**
 * [lolps] Bz（欧服第一劫）对线攻略表接入
 *
 * 数据源：公开 Google Sheets 的 CSV 导出端点（无需认证，永远指向表的当前最新版，
 * 作者更新表格后本端点内容随之变化——配合短 TTL 缓存即实现"自动跟更"）。
 * 结构：每行一个对线英雄（英文名），列含符文 / 难度 / 核心装 / 打法要点。
 */
import type { BzMatchupRow } from '@shared/types/counter-intel'
import axios, { type AxiosInstance } from 'axios'

export type { BzMatchupRow }

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

export interface GetBzZedMatchupOptions {
  /** 可注入主进程已有的 Axios 客户端，便于统一代理、重试和测试。 */
  httpClient?: AxiosInstance
  /** 徽章等只消费文字的调用方可关闭，避免额外拉取 Data Dragon。 */
  includeCoreItems?: boolean
  /** 装备库失败不会丢弃已获取的文字攻略；通过此回调交给上层 logger 留痕。 */
  onWarn?: (message: string) => void
}

export class BzGuideDataValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BzGuideDataValidationError'
  }
}

interface CachedResource<T> {
  expiresAt: number
  value?: T
  inFlight?: Promise<T>
}

const STALE_RETRY_TTL = 60 * 1000

/**
 * 同一客户端同一资源只允许一个刷新请求。刷新失败时旧值仍可用；首次加载失败则把错误
 * 原样抛给上层，由拥有 logger / IPC 语义的调用方诊断。
 */
function readThroughCache<T>(
  cache: CachedResource<T>,
  ttl: number,
  loader: () => Promise<T>
): Promise<T> {
  if (cache.value !== undefined && cache.expiresAt > Date.now()) {
    return Promise.resolve(cache.value)
  }
  if (cache.inFlight) return cache.inFlight

  const staleValue = cache.value
  const refresh = loader().then(
    (value) => {
      cache.value = value
      cache.expiresAt = Date.now() + ttl
      cache.inFlight = undefined
      return value
    },
    (error: unknown) => {
      cache.inFlight = undefined
      if (staleValue !== undefined) {
        // 源持续故障时避免每张徽标/每次查询都立刻重打外网；一分钟后再尝试刷新。
        cache.expiresAt = Date.now() + Math.min(ttl, STALE_RETRY_TTL)
        return staleValue
      }
      throw error
    }
  )
  cache.inFlight = refresh
  return refresh
}

function getClientCache<T>(
  caches: WeakMap<AxiosInstance, CachedResource<T>>,
  httpClient: AxiosInstance
): CachedResource<T> {
  const cached = caches.get(httpClient)
  if (cached) return cached
  const created: CachedResource<T> = { expiresAt: 0 }
  caches.set(httpClient, created)
  return created
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
const _itemMapCaches = new WeakMap<AxiosInstance, CachedResource<Map<string, number>>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Data Dragon 同名装备可能同时包含峡谷、竞技场等版本。这里只收录召唤师峡谷中确实
 * 可购买且未被商店隐藏的版本；同名兜底选择更小 id，绝不以“最大 id”猜当前版本。
 */
export function buildItemNameMap(payload: unknown): Map<string, number> {
  if (!isRecord(payload) || !isRecord(payload.data)) {
    throw new BzGuideDataValidationError('invalid Data Dragon item catalog')
  }

  const byName = new Map<string, number>()
  for (const [idStr, rawInfo] of Object.entries(payload.data)) {
    if (!isRecord(rawInfo)) continue
    const id = Number(idStr)
    const maps = isRecord(rawInfo.maps) ? rawInfo.maps : null
    const gold = isRecord(rawInfo.gold) ? rawInfo.gold : null
    if (
      !Number.isSafeInteger(id) ||
      id <= 0 ||
      maps?.['11'] !== true ||
      gold?.purchasable !== true ||
      rawInfo.inStore === false
    ) {
      continue
    }
    const nm = normalizeName(typeof rawInfo.name === 'string' ? rawInfo.name : '')
    if (!nm) continue
    const prev = byName.get(nm)
    if (prev === undefined || id < prev) byName.set(nm, id)
  }

  if (byName.size === 0) {
    throw new BzGuideDataValidationError('Data Dragon item catalog has no purchasable SR items')
  }
  return byName
}

async function loadItemNameMap(httpClient: AxiosInstance): Promise<Map<string, number>> {
  const versions = await httpClient.get<unknown>(
    'https://ddragon.leagueoflegends.com/api/versions.json',
    { timeout: 12000 }
  )
  const ver =
    Array.isArray(versions.data) && typeof versions.data[0] === 'string' && versions.data[0].trim()
      ? versions.data[0]
      : null
  if (!ver) throw new BzGuideDataValidationError('Data Dragon returned no current version')

  const items = await httpClient.get<unknown>(
    `https://ddragon.leagueoflegends.com/cdn/${ver}/data/en_US/item.json`,
    { timeout: 15000 }
  )
  return buildItemNameMap(items.data)
}

function ensureItemNameMap(httpClient: AxiosInstance): Promise<Map<string, number>> {
  const cache = getClientCache(_itemMapCaches, httpClient)
  return readThroughCache(cache, ITEM_MAP_TTL, () => loadItemNameMap(httpClient))
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

/**
 * 核心装文字链 → 所有合法方案。斜杠表示同一位置的并列选择，例如
 * `Voltaic/Profane → LDR` 会展开为两条序列；无法识别的位置沿用旧行为并跳过。
 */
export function resolveBuildItemSequences(
  coreBuild: string,
  byName: Map<string, number>
): number[][] {
  let builds: number[][] = [[]]
  for (const segment of (coreBuild || '').split(/→|->|>/)) {
    const choices = Array.from(
      new Set(
        segment
          .split('/')
          .map((choice) => resolveItemName(choice.trim(), byName))
          .filter((id): id is number => id !== null)
      )
    )
    if (choices.length === 0) continue

    builds = builds.flatMap((build) =>
      choices.map((id) => (build.includes(id) ? [...build] : [...build, id]))
    )
  }

  const unique = new Map<string, number[]>()
  for (const build of builds) unique.set(build.join(','), build)
  return [...unique.values()].filter((build) => build.length > 0)
}

/** 兼容旧调用方：返回斜杠展开后的第一条方案。 */
export function resolveBuildItems(coreBuild: string, byName: Map<string, number>): number[] {
  return resolveBuildItemSequences(coreBuild, byName)[0] ?? []
}

// ============================ CSV 解析 ==========================

/** 标准 CSV 解析（支持引号包裹的换行与转义引号） */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let closedQuotedField = false

  const finishField = () => {
    row.push(field)
    field = ''
    closedQuotedField = false
  }
  const finishRow = () => {
    finishField()
    rows.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
          closedQuotedField = true
        }
      } else if (ch === '\r') {
        if (text[i + 1] === '\n') i++
        field += '\n'
      } else {
        field += ch
      }
      continue
    }

    if (closedQuotedField) {
      if (ch === ',') {
        finishField()
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++
        finishRow()
      } else {
        throw new BzGuideDataValidationError(
          `invalid CSV character after closing quote at offset ${i}`
        )
      }
      continue
    }

    if (ch === '"') {
      if (field.length > 0) {
        throw new BzGuideDataValidationError(`invalid CSV quote at offset ${i}`)
      }
      inQuotes = true
    } else if (ch === ',') {
      finishField()
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      finishRow()
    } else {
      field += ch
    }
  }

  if (inQuotes) {
    throw new BzGuideDataValidationError('unterminated quoted CSV field')
  }
  if (field.length > 0 || row.length > 0 || closedQuotedField) {
    finishField()
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
    const normalized = r.map((cell) => normalizeName(cell))
    return (
      normalized.some((cell) => cell.includes('champion')) &&
      normalized.some((cell) => cell.includes('difficulty'))
    )
  })
  if (headerIdx < 0) {
    throw new BzGuideDataValidationError('BZ CSV header row was not found')
  }

  const header = rows[headerIdx].map((cell) => normalizeName(cell))
  const col = (name: string) => header.findIndex((value) => value.includes(normalizeName(name)))
  const cChampion = col('champion')
  const cRune = col('rune')
  const cDifficulty = col('difficulty')
  const cCore = col('core build')
  const cSummary = col('summary')
  const requiredColumns: Array<[string, number]> = [
    ['champion', cChampion],
    ['rune', cRune],
    ['difficulty', cDifficulty],
    ['core build', cCore],
    ['summary', cSummary]
  ]
  const missingColumns = requiredColumns.filter(([, index]) => index < 0).map(([name]) => name)
  if (missingColumns.length > 0) {
    throw new BzGuideDataValidationError(
      `BZ CSV is missing required columns: ${missingColumns.join(', ')}`
    )
  }

  const out: BzMatchupRow[] = []
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    if (!r.some((cell) => cell.trim().length > 0)) continue
    const champion = (r[cChampion] ?? '').trim()
    if (!champion || normalizeName(champion).length === 0) continue
    const rune = (r[cRune] ?? '').trim()
    const difficulty = (r[cDifficulty] ?? '').trim()
    const coreBuild = (r[cCore] ?? '').trim()
    const summary = (r[cSummary] ?? '').trim()
    // 五列是当前表的完整契约；任一内容列缺失都视为编辑中的半行。
    if (![rune, difficulty, coreBuild, summary].every(Boolean)) continue
    out.push({
      champion,
      rune,
      difficulty,
      coreBuild,
      summary,
      keystonePerkId: parseKeystone(rune)
    })
  }
  if (out.length === 0) {
    throw new BzGuideDataValidationError('BZ CSV contains no valid matchup rows')
  }
  return out
}

// ============================ 拉取与查询 ========================

const _tableCaches = new WeakMap<AxiosInstance, CachedResource<Map<string, BzMatchupRow>>>()

async function loadTable(httpClient: AxiosInstance): Promise<Map<string, BzMatchupRow>> {
  const { data } = await httpClient.get<unknown>(BZ_CSV_URL, {
    timeout: 12000,
    responseType: 'text'
  })
  if (typeof data !== 'string' || data.trim().length === 0) {
    throw new BzGuideDataValidationError('BZ CSV response is empty or not text')
  }

  const byName = new Map<string, BzMatchupRow>()
  for (const row of extractBzRows(parseCsv(data))) {
    const key = canonicalName(row.champion)
    if (byName.has(key)) {
      throw new BzGuideDataValidationError(`BZ CSV contains duplicate champion key: ${key}`)
    }
    byName.set(key, row)
  }
  if (byName.size === 0) {
    throw new BzGuideDataValidationError('BZ CSV contains no uniquely addressable matchup rows')
  }
  return byName
}

function ensureTable(httpClient: AxiosInstance): Promise<Map<string, BzMatchupRow>> {
  const cache = getClientCache(_tableCaches, httpClient)
  return readThroughCache(cache, BZ_CACHE_TTL, () => loadTable(httpClient))
}

/**
 * 按对位英雄的 OP.GG slug（英文名同源）查 Bz 攻略行。
 * 未命中返回 null；源请求或数据校验失败会抛出，由调用方记录并决定降级方式。
 * 缓存过期自动重拉，若刷新失败但存在旧缓存则回退旧值。
 */
export async function getBzZedMatchup(
  opponentSlug: string,
  options: GetBzZedMatchupOptions = {}
): Promise<BzMatchupRow | null> {
  if (!opponentSlug) return null
  const httpClient = options.httpClient ?? axios
  const resources = await Promise.all([
    ensureTable(httpClient),
    options.includeCoreItems === false
      ? Promise.resolve<Map<string, number> | null>(null)
      : ensureItemNameMap(httpClient).catch((error: unknown) => {
          options.onWarn?.(
            `Data Dragon 装备库获取失败，已保留 BZ 文字攻略: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
          return null
        })
  ])
  const [table, byName] = resources
  const key = canonicalName(opponentSlug)
  const found = table.get(key) ?? prefixLookup(table, key)
  if (!found) return null
  if (!byName || !found.coreBuild) return found

  return withCoreItems(found, byName)
}

/** 前缀兜底：表内常见缩写名（Cassio / Trynd / Twisted…），≥4 字符且唯一命中才认 */
function prefixLookup(table: Map<string, BzMatchupRow>, key: string): BzMatchupRow | null {
  const hits: BzMatchupRow[] = []
  for (const [name, row] of table) {
    if (name.length >= 4 && key.startsWith(name)) hits.push(row)
  }
  return hits.length === 1 ? hits[0] : null
}

/** 附加所有核心装方案（≥2 件才提供）；coreItemIds 固定兼容为第一条完整方案。 */
export function withCoreItems(row: BzMatchupRow, byName: Map<string, number>): BzMatchupRow {
  if (!row.coreBuild) return row
  const builds = resolveBuildItemSequences(row.coreBuild, byName).filter(
    (build) => build.length >= 2
  )
  if (builds.length === 0) return row
  return { ...row, coreItemIds: builds[0], coreItemBuilds: builds }
}
