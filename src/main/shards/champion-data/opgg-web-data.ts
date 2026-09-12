import type { ChampionAugment, ChampionItemBuildSlot } from '@shared/data-adapter/champion-data'

type RecordValue = Record<string, unknown>
export function isWebRecord(value: unknown): value is RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Read JSON payloads only. Never execute third-party scripts or React references. */
export function readOpggFlightRoots(raw: string): unknown[] {
  const chunks: string[] = []
  for (const match of raw.matchAll(/self\.__next_f\.push\((\[1,.*?\])\)<\/script>/gs)) {
    try {
      const chunk: unknown = JSON.parse(match[1])
      if (Array.isArray(chunk) && typeof chunk[1] === 'string') chunks.push(chunk[1])
    } catch {
      /* An incomplete script is not a data source. */
    }
  }
  const text = chunks.length ? chunks.join('') : raw
  const roots: unknown[] = []
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':')
    if (colon < 0 || !/^[\da-f]+$/i.test(line.slice(0, colon))) continue
    try {
      roots.push(JSON.parse(line.slice(colon + 1)))
    } catch {
      /* Non-JSON Flight record. */
    }
  }
  return roots
}

export function walkOpggObjects(value: unknown, visit: (record: RecordValue) => void) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkOpggObjects(item, visit))
  } else if (isWebRecord(value)) {
    visit(value)
    Object.values(value).forEach((item) => walkOpggObjects(item, visit))
  }
}

function mayhemPage(raw: string, slug: string, section: 'items' | 'augments') {
  const roots = readOpggFlightRoots(raw)
  // A successful HTTP status can still be a different mode, a redirect or an error page.
  const canonical = raw.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/i)?.[1]
  if (
    !canonical ||
    new URL(canonical).pathname.replace(/^\/zh-cn/, '') !==
      `/lol/modes/aram-mayhem/${slug}/${section}`
  )
    throw new Error('OP.GG Mayhem page identity mismatch')
  let patch: string | null = null
  roots.forEach((root) =>
    walkOpggObjects(root, (record) => {
      if (
        record.sub === 'aram_mayhem' &&
        record.detail === section &&
        isWebRecord(record.params) &&
        typeof record.params.game_patch_version === 'string'
      )
        patch = record.params.game_patch_version
    })
  )
  if (!patch) throw new Error('OP.GG Mayhem page has no verified mode/patch')
  return { roots, patch }
}

const EMPTY_PERFORMANCE = {
  games: null,
  wins: null,
  winRate: null,
  pickRate: null,
  rank: null,
  averagePlacement: null,
  firstPlaceRate: null
} as const

/** OP.GG hides statistical columns for Mayhem. Keep page recommendations without inventing rates. */
export function parseOpggMayhemItems(raw: string, slug: string) {
  const { roots, patch } = mayhemPage(raw, slug, 'items')
  const slots = new Map<string, ChampionItemBuildSlot>()
  const labels = {
    'Core builds': 'core',
    Boots: 'boots',
    'Starter items': 'starting',
    Items: 'last'
  } as const
  function visit(value: unknown) {
    if (!Array.isArray(value)) return
    if (value[0] === '$' && value[1] === 'section' && isWebRecord(value[3])) {
      let slot: ChampionItemBuildSlot['slot'] | undefined
      let rows: unknown[] | undefined
      walkOpggObjects(value[3], (record) => {
        if (typeof record.children === 'string' && Object.hasOwn(labels, record.children))
          slot = labels[record.children as keyof typeof labels]
        if (record.mode === 'aram_mayhem' && Array.isArray(record.data)) rows = record.data
      })
      if (slot && rows) {
        const options = rows.flatMap((row) => {
          if (
            !isWebRecord(row) ||
            !Array.isArray(row.ids) ||
            !row.ids.length ||
            !row.ids.every((id) => Number.isSafeInteger(id) && id > 0)
          )
            return []
          return [{ itemIds: row.ids as number[], performance: { ...EMPTY_PERFORMANCE } }]
        })
        if (options.length) slots.set(slot, { slot, options })
      }
    }
    for (const child of value) {
      if (Array.isArray(child)) visit(child)
      else if (isWebRecord(child)) Object.values(child).forEach(visit)
    }
  }
  roots.forEach(visit)
  if (!slots.size) throw new Error('OP.GG Mayhem item recommendations missing')
  return { patch, itemBuilds: [...slots.values()] }
}

const RARITY = { 1: 'kSilver', 2: 'kGold', 4: 'kPrismatic', 8: 'kEventChoice' } as const
function iconUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'opgg-static.akamaized.net'
      ? value
      : undefined
  } catch {
    return undefined
  }
}

export function parseOpggMayhemAugments(raw: string, slug: string) {
  const { roots, patch } = mayhemPage(raw, slug, 'augments')
  const augments = new Map<number, ChampionAugment>()
  roots.forEach((root) =>
    walkOpggObjects(root, (record) => {
      if (!Array.isArray(record.data)) return
      for (const row of record.data) {
        if (
          !isWebRecord(row) ||
          typeof row.id !== 'number' ||
          !Number.isSafeInteger(row.id) ||
          row.id <= 0 ||
          typeof row.tier !== 'number' ||
          !Number.isInteger(row.tier) ||
          row.tier < 0 ||
          row.tier > 6 ||
          typeof row.performance !== 'number' ||
          !Number.isFinite(row.performance) ||
          typeof row.popular !== 'number' ||
          !Number.isFinite(row.popular) ||
          row.popular < 0 ||
          row.popular > 100
        )
          continue
        augments.set(row.id, {
          augmentId: row.id,
          tier: row.tier,
          rank: null,
          rankChange: null,
          performanceScore: row.performance,
          popularity: row.popular,
          performance: { ...EMPTY_PERFORMANCE },
          bestChampionIds: [],
          ...(typeof row.name === 'string'
            ? {
                display: {
                  name: row.name,
                  iconPath: iconUrl(row.smallIcon),
                  rarity: RARITY[row.rarity as keyof typeof RARITY] ?? null,
                  description:
                    typeof row.desc === 'string'
                      ? row.desc.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
                      : ''
                }
              }
            : {})
        })
      }
    })
  )
  if (!augments.size) throw new Error('OP.GG Mayhem augments missing')
  return { patch, augments: [...augments.values()] }
}
