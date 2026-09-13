import type { BzImageIssue, BzImageLoadout, BzMatchupRow } from '@shared/types/counter-intel'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { unzipSync } from 'fflate'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'

import { type BzIconInspection, inspectBzIcon } from './icons'
import { BzGuideDataValidationError, canonicalName, extractBzRows, normalizeName } from './table'

export const BZ_WORKBOOK_MAX_BYTES = 24 * 1024 * 1024
const MAX_ROWS = 2000
const MAX_COLS = 100
const EMU_PER_POINT = 12700
const EMU_PER_PIXEL = 9525
type Xml = Record<string, any>
type Rect = { x: number; y: number; width: number; height: number }
type Picture = { rect: Rect; icon: BzIconInspection; transformed: boolean }
type Sheet = {
  name: string
  path: string
  xml: Xml
  cells: string[][]
  rows: BzMatchupRow[]
  championColumn: number
  imageColumn: number
}

function list(value: any): Xml[] {
  return value == null ? [] : Array.isArray(value) ? value : [value]
}
function number(value: unknown, fallback = NaN): number {
  if (value === undefined || value === null || value === '') return fallback
  const result = Number(value)
  return Number.isFinite(result) ? result : fallback
}
function fail(message: string): never {
  throw new BzGuideDataValidationError(`BZ workbook: ${message}`)
}

function xmlPart(parts: Record<string, Uint8Array>, path: string): Xml {
  const bytes = parts[path]
  if (!bytes || bytes.length > 4 * 1024 * 1024) fail(`missing or oversized part ${path}`)
  const text = Buffer.from(bytes).toString('utf8')
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true)
    fail(`invalid XML ${path}`)
  return new XMLParser({
    ignoreAttributes: false,
    removeNSPrefix: true,
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: false
  }).parse(text)
}

function relatedParts(parts: Record<string, Uint8Array>, owner: string) {
  const relPath = posix.join(posix.dirname(owner), '_rels', `${posix.basename(owner)}.rels`)
  const result = new Map<string, string>()
  if (!parts[relPath]) return result
  for (const rel of list(xmlPart(parts, relPath).Relationships?.Relationship)) {
    if (rel['@_TargetMode'] === 'External') continue
    const target = String(rel['@_Target'] ?? '')
    if (target.includes('\\') || target.includes(':') || target.includes('\0'))
      fail('invalid relationship')
    const resolved = posix.normalize(
      target.startsWith('/') ? target.slice(1) : posix.join(posix.dirname(owner), target)
    )
    if (!resolved.startsWith('xl/') || resolved.includes('../'))
      fail('relationship outside workbook')
    result.set(String(rel['@_Id']), resolved)
  }
  return result
}

function cellText(value: any): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (!value || typeof value !== 'object') return ''
  if (value.t !== undefined) return cellText(value.t)
  if (value['#text'] !== undefined) return String(value['#text'])
  if (value.r !== undefined) return list(value.r).map(cellText).join('')
  return ''
}

function columnIndex(letters: string) {
  let index = 0
  for (const char of letters) index = index * 26 + char.charCodeAt(0) - 64
  return index - 1
}

function readCells(xml: Xml, strings: string[]) {
  const cells: string[][] = []
  for (const row of list(xml.sheetData?.row)) {
    for (const cell of list(row.c)) {
      const address = /^([A-Z]+)(\d+)$/.exec(String(cell['@_r'] ?? ''))
      if (!address) fail('invalid cell address')
      const y = Number(address[2]) - 1
      const x = columnIndex(address[1])
      if (y < 0 || y >= MAX_ROWS || x < 0 || x >= MAX_COLS) fail('sheet is too large')
      while (cells.length <= y) cells.push([])
      const type = cell['@_t']
      const text =
        type === 's'
          ? strings[number(cell.v)]
          : type === 'inlineStr'
            ? cellText(cell.is)
            : type === 'e'
              ? ''
              : cellText(cell.v)
      if (type === 's' && text === undefined) fail('invalid shared-string reference')
      cells[y][x] = text ?? ''
    }
  }
  return cells.map((row) => Array.from({ length: row.length }, (_, index) => row[index] ?? ''))
}

function selectSheet(parts: Record<string, Uint8Array>): Sheet {
  const workbook = xmlPart(parts, 'xl/workbook.xml').workbook
  const relationships = relatedParts(parts, 'xl/workbook.xml')
  const strings = parts['xl/sharedStrings.xml']
    ? list(xmlPart(parts, 'xl/sharedStrings.xml').sst?.si).map(cellText)
    : []
  const candidates: Sheet[] = []
  for (const sheet of list(workbook?.sheets?.sheet)) {
    if (sheet['@_state'] && sheet['@_state'] !== 'visible') continue
    const path = relationships.get(sheet['@_id'])
    if (!path) fail('missing worksheet relationship')
    const xml = xmlPart(parts, path).worksheet
    if (!xml) fail('missing worksheet')
    const cells = readCells(xml, strings)
    const header = cells.find(
      (row) =>
        row.some((text) => normalizeName(text) === 'champion') &&
        row.some((text) => normalizeName(text) === 'difficulty')
    )
    if (!header) continue
    const championColumn = header.findIndex((text) => normalizeName(text) === 'champion')
    const imageColumns = header.flatMap((text, index) => {
      const key = normalizeName(text)
      return key.includes('summoner') && key.includes('startitem') ? [index] : []
    })
    if (imageColumns.length !== 1) fail('summoner/start item column is missing or duplicated')
    const rows = extractBzRows(cells)
    const names = new Set<string>()
    for (const row of rows) {
      const key = canonicalName(row.champion)
      if (names.has(key)) fail(`duplicate champion key: ${key}`)
      names.add(key)
      const physicalRows = cells.flatMap((cells, index) =>
        canonicalName(cells[championColumn] ?? '') === key ? [index + 1] : []
      )
      if (physicalRows.length !== 1) fail(`ambiguous champion row: ${key}`)
      row.sourceRow = physicalRows[0]
      row.sourceSheet = String(sheet['@_name'])
      row.sourceFormat = 'xlsx'
    }
    candidates.push({
      name: String(sheet['@_name']),
      path,
      xml,
      cells,
      rows,
      championColumn,
      imageColumn: imageColumns[0]
    })
  }
  if (candidates.length !== 1) fail('expected one uniquely identifiable matchup sheet')
  return candidates[0]
}

function dimensions(sheet: Sheet) {
  const defaultHeight = number(sheet.xml.sheetFormatPr?.['@_defaultRowHeight'], 15)
  const heights = Array.from({ length: MAX_ROWS }, () => defaultHeight * EMU_PER_POINT)
  for (const row of list(sheet.xml.sheetData?.row)) {
    const index = number(row['@_r']) - 1
    if (!Number.isInteger(index) || index < 0 || index >= heights.length)
      fail('invalid row dimensions')
    heights[index] =
      row['@_hidden'] === '1' ? 0 : number(row['@_ht'], defaultHeight) * EMU_PER_POINT
  }
  const columnWidth = (value: unknown) => Math.floor(number(value, 8.43) * 7 + 0.5) * EMU_PER_PIXEL
  const widths = Array.from({ length: MAX_COLS }, () =>
    columnWidth(sheet.xml.sheetFormatPr?.['@_defaultColWidth'])
  )
  for (const col of list(sheet.xml.cols?.col)) {
    const start = number(col['@_min']) - 1
    const end = Math.min(MAX_COLS, number(col['@_max']))
    if (start < 0 || !Number.isInteger(start) || !Number.isInteger(end))
      fail('invalid column dimensions')
    for (let i = start; i < end; i++)
      widths[i] = col['@_hidden'] === '1' ? 0 : columnWidth(col['@_width'])
  }
  if (
    heights.some((v) => v < 0 || !Number.isFinite(v)) ||
    widths.some((v) => v < 0 || !Number.isFinite(v))
  )
    fail('invalid grid dimensions')
  const boundaries = (values: number[]) => {
    const out = [0]
    for (const value of values) out.push(out[out.length - 1] + value)
    return out
  }
  return { ys: boundaries(heights), xs: boundaries(widths) }
}

function overlap(start: number, length: number, min: number, max: number) {
  return Math.max(0, Math.min(start + length, max) - Math.max(start, min))
}

function imageRect(anchor: Xml, grid: ReturnType<typeof dimensions>): Rect | null {
  const marker = (value: Xml) => {
    const row = number(value?.row)
    const col = number(value?.col)
    if (
      !Number.isInteger(row) ||
      !Number.isInteger(col) ||
      row < 0 ||
      col < 0 ||
      row >= grid.ys.length - 1 ||
      col >= grid.xs.length - 1
    )
      return null
    return { x: grid.xs[col] + number(value.colOff, 0), y: grid.ys[row] + number(value.rowOff, 0) }
  }
  const from = anchor.pos
    ? { x: number(anchor.pos['@_x']), y: number(anchor.pos['@_y']) }
    : marker(anchor.from)
  if (!from) return null
  const to = anchor.to ? marker(anchor.to) : null
  const width = to ? to.x - from.x : number(anchor.ext?.['@_cx'])
  const height = to ? to.y - from.y : number(anchor.ext?.['@_cy'])
  return [from.x, from.y, width, height].every(Number.isFinite) && width > 0 && height > 0
    ? { ...from, width, height }
    : null
}

function addIssue(
  loadout: BzImageLoadout,
  code: BzImageIssue['code'],
  field: BzImageIssue['field']
) {
  if (!loadout.issues.some((issue) => issue.code === code && issue.field === field))
    loadout.issues.push({ code, field })
}

/** Images are attributed by displayed area, not by the anchor row that Google happens to export. */
export function parseBzWorkbook(data: Uint8Array): BzMatchupRow[] {
  if (data.byteLength > BZ_WORKBOOK_MAX_BYTES) fail('download is too large')
  let expandedBytes = 0
  const seen = new Set<string>()
  const parts = unzipSync(data, {
    filter: (file) => {
      if (seen.has(file.name)) fail('duplicate ZIP part')
      seen.add(file.name)
      const wanted =
        file.name.startsWith('xl/') && (file.name.endsWith('.xml') || file.name.endsWith('.rels'))
      if (!wanted) return false
      expandedBytes += file.originalSize
      if (file.originalSize > 4 * 1024 * 1024 || expandedBytes > 12 * 1024 * 1024)
        fail('XML size limit exceeded')
      return true
    }
  })
  const sheet = selectSheet(parts)
  const grid = dimensions(sheet)
  const drawingPath = relatedParts(parts, sheet.path).get(sheet.xml.drawing?.['@_id'])
  const rows = new Map(sheet.rows.map((row) => [row.sourceRow!, row]))
  for (const row of rows.values()) row.imageLoadout = { status: 'partial', issues: [] }
  if (!drawingPath) {
    for (const row of rows.values())
      row.imageLoadout = {
        status: 'unavailable',
        issues: [{ code: 'source-unavailable', field: 'both' }]
      }
    return sheet.rows
  }
  const drawing = xmlPart(parts, drawingPath).wsDr
  const relationships = relatedParts(parts, drawingPath)
  const anchors = [
    ...list(drawing?.oneCellAnchor),
    ...list(drawing?.twoCellAnchor),
    ...list(drawing?.absoluteAnchor)
  ]
  if (anchors.length > 2000) fail('too many drawing objects')
  const needed = new Set<string>()
  const pending: Array<{ anchor: Xml; rect: Rect; path?: string }> = []
  const left = grid.xs[sheet.imageColumn]
  const right = grid.xs[sheet.imageColumn + 1]
  for (const anchor of anchors) {
    if (!anchor.pic) continue
    const rect = imageRect(anchor, grid)
    if (!rect) fail('unsupported image position')
    if (overlap(rect.x, rect.width, left, right) <= 0) continue
    const path = relationships.get(anchor.pic.blipFill?.blip?.['@_embed'])
    if (path) needed.add(path)
    pending.push({ anchor, rect, path })
  }
  let mediaBytes = 0
  const media = unzipSync(data, {
    filter: (file) => {
      if (!needed.has(file.name)) return false
      mediaBytes += file.originalSize
      if (file.originalSize > 2 * 1024 * 1024 || mediaBytes > 8 * 1024 * 1024)
        fail('image size limit exceeded')
      return true
    }
  })
  const inspected = new Map<string, BzIconInspection>()
  const pictures = new Map<number, Picture[]>()
  for (const { anchor, rect, path } of pending) {
    let icon = path ? inspected.get(path) : undefined
    if (!icon) {
      icon =
        path && media[path] ? inspectBzIcon(media[path]) : { identity: null, digest: 'unavailable' }
      if (path) inspected.set(path, icon)
    }
    const crop = anchor.pic.blipFill?.srcRect
    const transformed =
      (!!crop && Object.values(crop).some((v) => number(v, 0) !== 0)) ||
      number(anchor.pic.spPr?.xfrm?.['@_rot'], 0) !== 0
    const candidates = [...rows.keys()]
      .map((row) => ({
        row,
        fraction: overlap(rect.y, rect.height, grid.ys[row - 1], grid.ys[row]) / rect.height
      }))
      .filter(({ fraction }) => fraction > 0)
    const dominant = candidates.filter(({ fraction }) => fraction >= 0.9)
    if (dominant.length !== 1 || overlap(rect.x, rect.width, left, right) / rect.width < 0.9) {
      for (const candidate of candidates) {
        addIssue(rows.get(candidate.row)!.imageLoadout!, 'ambiguous-position', 'both')
        const group = pictures.get(candidate.row) ?? []
        group.push({ rect, icon, transformed })
        pictures.set(candidate.row, group)
      }
      continue
    }
    const row = dominant[0].row
    const group = pictures.get(row) ?? []
    if (
      !group.some(
        (p) => p.icon.digest === icon!.digest && JSON.stringify(p.rect) === JSON.stringify(rect)
      )
    )
      group.push({ rect, icon, transformed })
    pictures.set(row, group)
  }
  for (const [rowNumber, row] of rows) {
    const loadout = row.imageLoadout!
    const group = (pictures.get(rowNumber) ?? []).sort(
      (a, b) => a.rect.y - b.rect.y || a.rect.x - b.rect.x
    )
    for (const picture of group) {
      if (!picture.icon.identity || picture.transformed) addIssue(loadout, 'unknown-image', 'both')
    }
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i],
          b = group[j]
        const area =
          overlap(a.rect.x, a.rect.width, b.rect.x, b.rect.x + b.rect.width) *
          overlap(a.rect.y, a.rect.height, b.rect.y, b.rect.y + b.rect.height)
        // Slightly touching edges are common in the source; substantial occlusion is ambiguous.
        if (area > 0.25 * Math.min(a.rect.width * a.rect.height, b.rect.width * b.rect.height)) {
          const kind =
            a.icon.identity?.kind === b.icon.identity?.kind ? a.icon.identity?.kind : undefined
          addIssue(
            loadout,
            'overlapping-images',
            kind === 'spell' ? 'spells' : kind === 'item' ? 'starter' : 'both'
          )
        }
      }
    }
    const spells = group
      .filter((p) => p.icon.identity?.kind === 'spell')
      .sort((a, b) => a.rect.x - b.rect.x)
      .map((p) => p.icon.identity!.id)
    const items = group
      .filter((p) => p.icon.identity?.kind === 'item')
      .map((p) => p.icon.identity!.id)
    if (spells.length !== 2 || new Set(spells).size !== 2)
      addIssue(loadout, spells.length ? 'ambiguous-spells' : 'missing-spells', 'spells')
    if (items.length !== 1)
      addIssue(loadout, items.length ? 'ambiguous-starter' : 'missing-starter', 'starter')
    if (!loadout.issues.some((issue) => issue.field === 'spells' || issue.field === 'both'))
      loadout.spellIds = spells as [number, number]
    if (!loadout.issues.some((issue) => issue.field === 'starter' || issue.field === 'both'))
      loadout.starterItemId = items[0]
    loadout.status = loadout.spellIds && loadout.starterItemId ? 'ready' : 'partial'
    loadout.fingerprint = createHash('sha256')
      .update(JSON.stringify(group.map((p) => [p.icon.digest, p.rect])))
      .digest('hex')
    if (loadout.issues.length)
      loadout.previews = [
        ...new Set(group.map((p) => p.icon.preview).filter((p): p is string => !!p))
      ].slice(0, 6)
  }
  return sheet.rows
}
