import type { BzMatchupRow } from '@shared/types/counter-intel'
import type { AxiosInstance } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BZ_CACHE_TTL,
  BZ_CSV_URL,
  BzGuideDataValidationError,
  buildItemNameMap,
  canonicalName,
  extractBzRows,
  getBzZedMatchup,
  parseCsv,
  resolveBuildItemSequences,
  resolveItemName,
  withCoreItems
} from './bz-guide'

const VALID_CSV = [
  'Champion,Rune,Difficulty,Core Build,Summary',
  'Trynd,Lethal Tempo,Hard,Voltaic/Profane -> LDR,Respect level one',
  'Monkey King,Conq,Medium,Profane -> LDR,Hold shadow'
].join('\n')

const ITEM_CATALOG = {
  data: {
    // Current Summoner's Rift item and the real Arena-style 22xxxx duplicate.
    '6699': {
      name: 'Voltaic Cyclosword',
      maps: { '11': true, '30': false },
      gold: { purchasable: true }
    },
    '226699': {
      name: 'Voltaic Cyclosword',
      maps: { '11': false, '30': true },
      gold: { purchasable: true }
    },
    '6698': {
      name: 'Profane Hydra',
      maps: { '11': true },
      gold: { purchasable: true }
    },
    '3036': {
      name: "Lord Dominik's Regards",
      maps: { '11': true },
      gold: { purchasable: true }
    }
  }
}

function createHttpClient(
  get: (url: string, config?: unknown) => Promise<{ data: unknown }>
): AxiosInstance {
  return { get: vi.fn(get) } as unknown as AxiosInstance
}

function getMock(httpClient: AxiosInstance) {
  return httpClient.get as ReturnType<typeof vi.fn>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('BZ item mapping', () => {
  it("selects the purchasable Summoner's Rift item instead of its higher-id Arena duplicate", () => {
    const byName = buildItemNameMap({
      data: {
        ...ITEM_CATALOG.data,
        '16699': {
          name: 'Voltaic Cyclosword',
          maps: { '11': true },
          gold: { purchasable: true },
          inStore: false
        },
        '26699': {
          name: 'Voltaic Cyclosword',
          maps: { '11': true },
          gold: { purchasable: false }
        }
      }
    })

    expect(byName.get('voltaiccyclosword')).toBe(6699)
  })

  it('resolves exact names, item aliases, and unique prefixes', () => {
    const byName = buildItemNameMap(ITEM_CATALOG)

    expect(resolveItemName('LDR', byName)).toBe(3036)
    expect(resolveItemName('Profane', byName)).toBe(6698)
    expect(resolveItemName('Voltaic', byName)).toBe(6699)
  })

  it('expands Voltaic/Profane into two valid builds and keeps the first for compatibility', () => {
    const byName = buildItemNameMap(ITEM_CATALOG)
    const builds = resolveBuildItemSequences('Voltaic / Profane -> LDR', byName)

    expect(builds).toEqual([
      [6699, 3036],
      [6698, 3036]
    ])

    const row: BzMatchupRow = {
      champion: 'Trynd',
      rune: 'Lethal Tempo',
      difficulty: 'Hard',
      coreBuild: 'Voltaic / Profane -> LDR',
      summary: 'Respect level one',
      keystonePerkId: 8008
    }
    expect(withCoreItems(row, byName)).toMatchObject({
      coreItemIds: [6699, 3036],
      coreItemBuilds: [
        [6699, 3036],
        [6698, 3036]
      ]
    })
  })

  it("rejects an item catalog with no shop-enabled Summoner's Rift entries", () => {
    expect(() =>
      buildItemNameMap({
        data: {
          '226699': {
            name: 'Voltaic Cyclosword',
            maps: { '30': true },
            gold: { purchasable: true }
          }
        }
      })
    ).toThrow(BzGuideDataValidationError)
  })
})

describe('BZ CSV parsing and validation', () => {
  it('parses preamble rows, quoted commas, escaped quotes, CRLF, and quoted multiline fields', () => {
    const csv = [
      'Bz matchup guide,,,,',
      ' Champion , Rune , Difficulty , Core Build , Summary ',
      'Trynd,"Lethal Tempo\r\nResolve",Hard,"Voltaic/Profane -> LDR","Wait, then ""all in"""',
      'Monkey King,Conq,Medium,Profane -> LDR,Hold shadow'
    ].join('\r\n')

    const rows = extractBzRows(parseCsv(csv))

    expect(rows).toEqual([
      {
        champion: 'Trynd',
        rune: 'Lethal Tempo\nResolve',
        difficulty: 'Hard',
        coreBuild: 'Voltaic/Profane -> LDR',
        summary: 'Wait, then "all in"',
        keystonePerkId: 8008
      },
      {
        champion: 'Monkey King',
        rune: 'Conq',
        difficulty: 'Medium',
        coreBuild: 'Profane -> LDR',
        summary: 'Hold shadow',
        keystonePerkId: 8010
      }
    ])
    expect(canonicalName(rows[1].champion)).toBe('wukong')
  })

  it('skips incomplete rows while retaining valid rows', () => {
    const rows = extractBzRows(
      parseCsv(
        [
          'Champion,Rune,Difficulty,Core Build,Summary',
          ',Conq,Hard,Profane -> LDR,Missing champion',
          'Ahri,,,,',
          'Zed,Electrocute,,Voltaic -> LDR,Missing difficulty',
          'Wukong,Conq,Medium,Profane -> LDR,Hold shadow'
        ].join('\n')
      )
    )

    expect(rows.map((row) => row.champion)).toEqual(['Wukong'])
  })

  it('rejects malformed CSV and missing required columns', () => {
    expect(() => parseCsv('Champion,Summary\n"Trynd,unterminated')).toThrow(
      BzGuideDataValidationError
    )
    expect(() => extractBzRows(parseCsv('Champion,Difficulty\nTrynd,Hard'))).toThrow(
      /missing required columns/
    )
    expect(() => extractBzRows(parseCsv('Champion,Rune,Difficulty,Core Build,Summary'))).toThrow(
      /no valid matchup rows/
    )
  })
})

describe('BZ loading and cache behavior', () => {
  it('uses the injected client and does not fetch Data Dragon when core items are disabled', async () => {
    const httpClient = createHttpClient(async () => ({ data: VALID_CSV }))

    const row = await getBzZedMatchup('tryndamere', {
      httpClient,
      includeCoreItems: false
    })

    expect(row?.champion).toBe('Trynd')
    expect(row?.coreItemIds).toBeUndefined()
    expect(getMock(httpClient)).toHaveBeenCalledTimes(1)
    expect(getMock(httpClient)).toHaveBeenCalledWith(
      BZ_CSV_URL,
      expect.objectContaining({ responseType: 'text' })
    )
  })

  it('deduplicates concurrent table and item catalog requests', async () => {
    const httpClient = createHttpClient(async (url) => {
      if (url === BZ_CSV_URL) return { data: VALID_CSV }
      if (url.endsWith('/api/versions.json')) return { data: ['16.17.1'] }
      if (url.endsWith('/item.json')) return { data: ITEM_CATALOG }
      throw new Error(`unexpected URL: ${url}`)
    })

    const [first, second] = await Promise.all([
      getBzZedMatchup('tryndamere', { httpClient }),
      getBzZedMatchup('tryndamere', { httpClient })
    ])

    expect(first?.coreItemBuilds).toEqual([
      [6699, 3036],
      [6698, 3036]
    ])
    expect(second).toEqual(first)
    expect(getMock(httpClient)).toHaveBeenCalledTimes(3)
    expect(getMock(httpClient).mock.calls.filter(([url]) => url === BZ_CSV_URL)).toHaveLength(1)
    expect(
      getMock(httpClient).mock.calls.filter(([url]) => String(url).endsWith('/api/versions.json'))
    ).toHaveLength(1)
    expect(
      getMock(httpClient).mock.calls.filter(([url]) => String(url).endsWith('/item.json'))
    ).toHaveLength(1)
  })

  it('falls back to stale table data when an expired refresh fails', async () => {
    let now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let failRefresh = false
    const httpClient = createHttpClient(async (url) => {
      if (url !== BZ_CSV_URL) throw new Error(`unexpected URL: ${url}`)
      if (failRefresh) throw new Error('Google unavailable')
      return { data: VALID_CSV }
    })

    const first = await getBzZedMatchup('tryndamere', {
      httpClient,
      includeCoreItems: false
    })
    now += BZ_CACHE_TTL + 1
    failRefresh = true
    const stale = await getBzZedMatchup('tryndamere', {
      httpClient,
      includeCoreItems: false
    })
    const staleDuringBackoff = await getBzZedMatchup('tryndamere', {
      httpClient,
      includeCoreItems: false
    })

    expect(stale).toEqual(first)
    expect(staleDuringBackoff).toEqual(first)
    expect(getMock(httpClient)).toHaveBeenCalledTimes(2)
  })

  it('falls back to a stale item map when its expired refresh fails', async () => {
    let now = 2_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    let versionLoads = 0
    const httpClient = createHttpClient(async (url) => {
      if (url === BZ_CSV_URL) return { data: VALID_CSV }
      if (url.endsWith('/api/versions.json')) {
        versionLoads++
        if (versionLoads > 1) throw new Error('Data Dragon unavailable')
        return { data: ['16.17.1'] }
      }
      if (url.endsWith('/item.json')) return { data: ITEM_CATALOG }
      throw new Error(`unexpected URL: ${url}`)
    })

    const first = await getBzZedMatchup('tryndamere', { httpClient })
    now += 7 * 60 * 60 * 1000
    const stale = await getBzZedMatchup('tryndamere', { httpClient })

    expect(stale?.coreItemBuilds).toEqual(first?.coreItemBuilds)
    expect(versionLoads).toBe(2)
  })

  it('propagates a first-load source error so the caller can diagnose it', async () => {
    const sourceError = new Error('Google unavailable')
    const httpClient = createHttpClient(async () => {
      throw sourceError
    })

    await expect(
      getBzZedMatchup('tryndamere', { httpClient, includeCoreItems: false })
    ).rejects.toBe(sourceError)
  })

  it('loads the table and item catalog in parallel, preserving text when items fail', async () => {
    let releaseTable!: () => void
    const tableGate = new Promise<void>((resolve) => (releaseTable = resolve))
    const warning = vi.fn()
    let itemStarted = false
    const httpClient = createHttpClient(async (url) => {
      if (url === BZ_CSV_URL) {
        await tableGate
        return { data: VALID_CSV }
      }
      if (url.endsWith('/api/versions.json')) {
        itemStarted = true
        throw new Error('Data Dragon unavailable')
      }
      throw new Error(`unexpected URL: ${url}`)
    })

    const pending = getBzZedMatchup('tryndamere', { httpClient, onWarn: warning })
    await vi.waitFor(() => expect(itemStarted).toBe(true))
    releaseTable()
    const row = await pending

    expect(row?.summary).toBe('Respect level one')
    expect(row?.coreItemBuilds).toBeUndefined()
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Data Dragon unavailable'))
  })

  it('rejects duplicate canonical champion keys instead of silently overwriting a row', async () => {
    const duplicateCsv = [
      'Champion,Rune,Difficulty,Core Build,Summary',
      'Monkey King,Conq,Medium,Profane -> LDR,First row',
      'Wukong,Conq,Hard,Voltaic -> LDR,Duplicate alias'
    ].join('\n')
    const httpClient = createHttpClient(async () => ({ data: duplicateCsv }))

    await expect(
      getBzZedMatchup('wukong', { httpClient, includeCoreItems: false })
    ).rejects.toThrow(/duplicate champion key: wukong/)
  })
})
