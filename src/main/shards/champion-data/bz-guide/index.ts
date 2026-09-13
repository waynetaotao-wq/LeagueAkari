/**
 * [lolps] Bz（欧服第一劫）对线攻略表接入
 *
 * 数据源：公开 Google Sheets 的 Excel 导出及 CSV 文字回退（无需认证，
 * 作者更新表格后本端点内容随之变化——配合短 TTL 缓存即实现"自动跟更"）。
 * 结构：每行一个对线英雄（英文名），列含符文 / 难度 / 核心装 / 打法要点。
 */
import type { BzMatchupRow } from '@shared/types/counter-intel'
import axios, { type AxiosInstance } from 'axios'

import {
  BzGuideDataValidationError,
  canonicalName,
  extractBzRows,
  normalizeName,
  parseCsv
} from './table'
import { BZ_WORKBOOK_MAX_BYTES, parseBzWorkbook } from './workbook'

export {
  BzGuideDataValidationError,
  canonicalName,
  extractBzRows,
  normalizeName,
  parseCsv,
  parseKeystone,
  KEYSTONE_MAP
} from './table'

export type { BzMatchupRow }

// ============================ 可调区 ============================

/** 表文档 id 与工作表 gid（作者若开新表页在此更新） */
export const BZ_SHEET_ID = '1FInDZ2JhIyto2y-FnCcgCVlAYcjRaF7egcpsV41Spic'
export const BZ_SHEET_GID = '1026317672'
/** 缓存时长：过期后下次查询重拉；非后台实时订阅。 */
export const BZ_CACHE_TTL = 10 * 60 * 1000
/** 该攻略仅对此英雄生效（劫） */
export const BZ_MY_CHAMPION_ID = 238

export const BZ_CSV_URL = `https://docs.google.com/spreadsheets/d/${BZ_SHEET_ID}/export?format=csv&gid=${BZ_SHEET_GID}`
export const BZ_XLSX_URL = `https://docs.google.com/spreadsheets/d/${BZ_SHEET_ID}/export?format=xlsx`

// ============================ 类型 ==============================

export interface GetBzZedMatchupOptions {
  /** 可注入主进程已有的 Axios 客户端，便于统一代理、重试和测试。 */
  httpClient?: AxiosInstance
  /** 不需要核心装备映射时可关闭；图片仍须核对当前补丁。 */
  includeCoreItems?: boolean
  /** false 为轻量 CSV 文字模式，默认读取完整工作簿和图片。 */
  includeImages?: boolean
  force?: boolean
  /** 装备库失败不会丢弃已获取的文字攻略；通过此回调交给上层 logger 留痕。 */
  onWarn?: (message: string) => void
}

interface CachedResource<T> {
  expiresAt: number
  fetchedAt?: number
  stale?: boolean
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
  loader: () => Promise<T>,
  force = false
): Promise<T> {
  if (!force && cache.value !== undefined && cache.expiresAt > Date.now()) {
    return Promise.resolve(cache.value)
  }
  if (cache.inFlight) return cache.inFlight

  const staleValue = cache.value
  const refresh = loader().then(
    (value) => {
      cache.value = value
      cache.fetchedAt = Date.now()
      cache.stale = false
      cache.expiresAt = Date.now() + ttl
      cache.inFlight = undefined
      return value
    },
    (error: unknown) => {
      cache.inFlight = undefined
      if (staleValue !== undefined) {
        cache.stale = true
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

/** 与在线表格同周期核对装备库，避免补丁后继续沿用长时间旧映射。 */
const ITEM_MAP_TTL = BZ_CACHE_TTL
interface ItemCatalog {
  byName: Map<string, number>
  version: string
}
const _itemMapCaches = new WeakMap<AxiosInstance, CachedResource<ItemCatalog>>()
const _spellCaches = new WeakMap<
  AxiosInstance,
  { version: string; cache: CachedResource<Set<number>> }
>()

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

async function loadItemNameMap(httpClient: AxiosInstance): Promise<ItemCatalog> {
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
  return { byName: buildItemNameMap(items.data), version: ver }
}

function ensureItemNameMap(httpClient: AxiosInstance, force = false): Promise<ItemCatalog> {
  const cache = getClientCache(_itemMapCaches, httpClient)
  return readThroughCache(cache, ITEM_MAP_TTL, () => loadItemNameMap(httpClient), force)
}

async function ensureSpells(httpClient: AxiosInstance, version: string, force = false) {
  let entry = _spellCaches.get(httpClient)
  if (!entry || entry.version !== version) {
    entry = { version, cache: { expiresAt: 0 } }
    _spellCaches.set(httpClient, entry)
  }
  const ids = await readThroughCache(
    entry.cache,
    ITEM_MAP_TTL,
    async () => {
      const { data } = await httpClient.get<unknown>(
        `https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/summoner.json`,
        { timeout: 12000 }
      )
      if (!isRecord(data) || !isRecord(data.data))
        throw new BzGuideDataValidationError('invalid summoner spell catalog')
      const ids = new Set<number>()
      for (const spell of Object.values(data.data)) {
        if (!isRecord(spell) || !Array.isArray(spell.modes) || !spell.modes.includes('CLASSIC'))
          continue
        const id = Number(spell.key)
        if (Number.isSafeInteger(id) && id > 0) ids.add(id)
      }
      if (!ids.size) throw new BzGuideDataValidationError('empty summoner spell catalog')
      return ids
    },
    force
  )
  return entry.cache.stale ? null : ids
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
 * `Voltaic/Profane → LDR` 会展开为两条序列；任何位置/选项无法识别就保留原文，不拼接残缺方案。
 */
export function resolveBuildItemSequences(
  coreBuild: string,
  byName: Map<string, number>
): number[][] {
  let builds: number[][] = [[]]
  for (const segment of (coreBuild || '').split(/→|->|>/)) {
    if (segment.split('/').some((choice) => resolveItemName(choice.trim(), byName) === null)) {
      return []
    }
    const choices = Array.from(
      new Set(
        segment
          .split('/')
          .map((choice) => resolveItemName(choice.trim(), byName))
          .filter((id): id is number => id !== null)
      )
    )
    if (choices.length === 0) return []

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

// ============================ 拉取与查询 ========================

const _tableCaches = new WeakMap<AxiosInstance, CachedResource<Map<string, BzMatchupRow>>>()
const _workbookCaches = new WeakMap<AxiosInstance, CachedResource<Map<string, BzMatchupRow>>>()

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
    byName.set(key, { ...row, sourceFormat: 'csv' })
  }
  if (byName.size === 0) {
    throw new BzGuideDataValidationError('BZ CSV contains no uniquely addressable matchup rows')
  }
  return byName
}

async function ensureTable(
  httpClient: AxiosInstance,
  images: boolean,
  force = false,
  onWarn?: (message: string) => void
): Promise<Map<string, BzMatchupRow>> {
  const cache = getClientCache(images ? _workbookCaches : _tableCaches, httpClient)
  const value = await readThroughCache(
    cache,
    BZ_CACHE_TTL,
    async () => {
      if (!images) return loadTable(httpClient)
      try {
        const { data } = await httpClient.get<ArrayBuffer>(BZ_XLSX_URL, {
          responseType: 'arraybuffer',
          timeout: 15000,
          maxContentLength: BZ_WORKBOOK_MAX_BYTES,
          'axios-retry': { retries: 0 }
        })
        const bytes = Buffer.isBuffer(data)
          ? data
          : data instanceof ArrayBuffer
            ? new Uint8Array(data)
            : null
        if (!bytes) throw new BzGuideDataValidationError('BZ Excel response is not binary')
        return new Map(parseBzWorkbook(bytes).map((row) => [canonicalName(row.champion), row]))
      } catch (error) {
        onWarn?.(
          `图片表读取失败，尝试 CSV 文字回退: ${error instanceof Error ? error.message : String(error)}`
        )
        const textRows = await loadTable(httpClient)
        for (const row of textRows.values())
          row.imageLoadout = {
            status: 'unavailable',
            issues: [{ code: 'source-unavailable', field: 'both' }]
          }
        return textRows
      }
    },
    force
  )
  if (images && [...value.values()].some((row) => row.imageLoadout?.status === 'unavailable'))
    cache.expiresAt = Math.min(cache.expiresAt, Date.now() + STALE_RETRY_TTL)
  return value
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
  const images = options.includeImages !== false
  const needsCatalog = images || options.includeCoreItems !== false
  const resources = await Promise.all([
    ensureTable(httpClient, images, options.force, options.onWarn).then((table) => {
      const { fetchedAt, stale } = getClientCache(
        images ? _workbookCaches : _tableCaches,
        httpClient
      )
      return { table, fetchedAt, stale }
    }),
    !needsCatalog
      ? Promise.resolve(null)
      : ensureItemNameMap(httpClient, options.force)
          .then((catalog) => ({
            catalog,
            stale: getClientCache(_itemMapCaches, httpClient).stale === true
          }))
          .catch((error: unknown) => {
            options.onWarn?.(
              `Data Dragon 装备库获取失败，已保留 BZ 文字攻略: ${
                error instanceof Error ? error.message : String(error)
              }`
            )
            return null
          })
  ])
  // Capture metadata with each response: another window can force a refresh while a catalog waits.
  const [snapshot, catalogSnapshot] = resources
  const { table } = snapshot
  const catalog = catalogSnapshot?.catalog
  const byName = catalog?.byName
  const key = canonicalName(opponentSlug)
  const found = table.get(key) ?? prefixLookup(table, key)
  if (!found) return null
  const row: BzMatchupRow = {
    ...found,
    fetchedAt: snapshot.fetchedAt,
    stale: snapshot.stale === true,
    itemCatalogStale: needsCatalog && (!byName || catalogSnapshot?.stale === true)
  }
  if (row.stale) options.onWarn?.('表格刷新失败，当前展示的是旧缓存，禁止自动应用')
  if (row.imageLoadout && row.imageLoadout.status !== 'unavailable' && !row.stale) {
    row.imageLoadout = { ...row.imageLoadout, issues: [...row.imageLoadout.issues] }
    const loadout = row.imageLoadout
    if (!catalog || row.itemCatalogStale) {
      delete loadout.spellIds
      delete loadout.starterItemId
      loadout.issues.push({ code: 'catalog-unavailable', field: 'both' })
    } else {
      loadout.catalogVersion = catalog.version
      if (loadout.starterItemId && ![...catalog.byName.values()].includes(loadout.starterItemId)) {
        delete loadout.starterItemId
        loadout.issues.push({ code: 'unavailable-in-patch', field: 'starter' })
      }
      if (loadout.spellIds) {
        const spells = await ensureSpells(httpClient, catalog.version, options.force).catch(
          (error: unknown) => {
            options.onWarn?.(
              `召唤师技能库读取失败: ${error instanceof Error ? error.message : String(error)}`
            )
            return null
          }
        )
        if (!spells || !loadout.spellIds.every((id) => spells.has(id))) {
          delete loadout.spellIds
          loadout.issues.push({
            code: spells ? 'unavailable-in-patch' : 'catalog-unavailable',
            field: 'spells'
          })
        }
      }
    }
    loadout.status = loadout.spellIds && loadout.starterItemId ? 'ready' : 'partial'
  }
  if (options.includeCoreItems === false) return row
  if (!byName || !found.coreBuild || row.stale || row.itemCatalogStale) return row
  return withCoreItems(row, byName)
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
  if (builds.length === 0)
    return {
      ...row,
      unresolvedItems: row.coreBuild
        .split(/→|->|>|\//)
        .map((part) => part.trim())
        .filter((part) => resolveItemName(part, byName) === null)
    }
  return { ...row, coreItemIds: builds[0], coreItemBuilds: builds }
}
