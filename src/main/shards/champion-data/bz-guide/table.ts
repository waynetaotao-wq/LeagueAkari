import type { BzMatchupRow } from '@shared/types/counter-intel'

export class BzGuideDataValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BzGuideDataValidationError'
  }
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
