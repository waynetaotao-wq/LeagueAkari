import { resolveBzImageLoadout } from '@shared/utils/bz-image-loadout'
import type { AxiosInstance } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultPictures, workbookFixture } from './fixtures/workbook'
import { BZ_CACHE_TTL, BZ_CSV_URL, BZ_XLSX_URL, getBzZedMatchup } from './index'

function fixtureClient() {
  const state = {
    workbook: workbookFixture(),
    csv: 'Champion,Rune,Difficulty,Core Build,Summary\nAhri,Electrocute,Hard,Voltaic -> LDR,New text',
    version: '16.18.1',
    spellIds: [4, 14],
    itemIds: [1054, 1055],
    failWorkbook: false,
    failCsv: false,
    failItems: false,
    failSpells: false
  }
  const get = vi.fn(async (url: string) => {
    if (url === BZ_XLSX_URL) {
      if (state.failWorkbook) throw new Error('Excel unavailable')
      return { data: state.workbook }
    }
    if (url === BZ_CSV_URL) {
      if (state.failCsv) throw new Error('CSV unavailable')
      return { data: state.csv }
    }
    if (url.endsWith('/versions.json')) return { data: [state.version] }
    if (url.endsWith('/item.json')) {
      if (state.failItems) throw new Error('Items unavailable')
      return {
        data: {
          data: Object.fromEntries(
            state.itemIds.map((id) => [
              id,
              { name: `Item ${id}`, maps: { '11': true }, gold: { purchasable: true } }
            ])
          )
        }
      }
    }
    if (url.endsWith('/summoner.json')) {
      if (state.failSpells) throw new Error('Spells unavailable')
      return {
        data: {
          data: Object.fromEntries(
            state.spellIds.map((id) => [id, { key: String(id), modes: ['CLASSIC'] }])
          )
        }
      }
    }
    throw new Error(`Unexpected URL ${url}`)
  })
  return { state, get, httpClient: { get } as unknown as AxiosInstance }
}

afterEach(() => vi.restoreAllMocks())

describe('Bz image refresh to recommendation flow', () => {
  it('keeps each table timestamp tied to its own snapshot while another window refreshes', async () => {
    const initialTime = Date.UTC(2026, 8, 12)
    let now = initialTime
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { state, httpClient, get } = fixtureClient()
    let releaseItems!: () => void
    const gate = new Promise<void>((resolve) => {
      releaseItems = resolve
    })
    const original = get.getMockImplementation()!
    get.mockImplementation(async (url) => {
      if (url.endsWith('/item.json')) await gate
      return original(url)
    })
    const first = getBzZedMatchup('ahri', { httpClient })
    // Allow the first workbook snapshot to finish while the shared catalog remains pending.
    await vi.waitFor(() =>
      expect(get.mock.calls.some(([url]) => url.endsWith('/item.json'))).toBe(true)
    )
    await new Promise((resolve) => setImmediate(resolve))
    now += 5000
    state.workbook = workbookFixture({
      rows: [{ row: 8, champion: 'Ahri', summary: 'Updated in another window' }]
    })
    const refreshed = getBzZedMatchup('ahri', { httpClient, force: true })
    await vi.waitFor(() =>
      expect(get.mock.calls.filter(([url]) => url === BZ_XLSX_URL)).toHaveLength(2)
    )
    await new Promise((resolve) => setImmediate(resolve))
    releaseItems()
    const [oldRow, newRow] = await Promise.all([first, refreshed])
    expect(oldRow).toMatchObject({ summary: 'Hold shadow', fetchedAt: initialTime })
    expect(newRow).toMatchObject({ summary: 'Updated in another window', fetchedAt: now })
  })
  it('coalesces concurrent downloads and atomically replaces text, row and image recommendations on refresh', async () => {
    const { state, get, httpClient } = fixtureClient()
    const [first, concurrent] = await Promise.all([
      getBzZedMatchup('ahri', { httpClient }),
      getBzZedMatchup('ahri', { httpClient })
    ])
    expect(concurrent).toEqual(first)
    expect(get.mock.calls.filter(([url]) => url === BZ_XLSX_URL)).toHaveLength(1)
    expect(get.mock.calls.filter(([url]) => url.endsWith('/summoner.json'))).toHaveLength(1)
    expect(first?.imageLoadout).toMatchObject({
      status: 'ready',
      spellIds: [4, 14],
      starterItemId: 1055,
      catalogVersion: '16.18.1'
    })
    state.workbook = workbookFixture({
      rows: [{ row: 15, champion: 'Ahri', summary: 'Changed advice' }],
      pictures: defaultPictures(15, 'DoransShield')
    })
    expect((await getBzZedMatchup('ahri', { httpClient }))?.sourceRow).toBe(8)
    const current = await getBzZedMatchup('ahri', { httpClient, force: true })
    expect(current).toMatchObject({
      sourceRow: 15,
      summary: 'Changed advice',
      imageLoadout: { starterItemId: 1054 }
    })
    expect(current?.imageLoadout?.fingerprint).not.toBe(first?.imageLoadout?.fingerprint)
    expect(resolveBzImageLoadout(current!)?.starterItemId).toBe(1054)
  })

  it('automatically rechecks the workbook after TTL without a manual refresh', async () => {
    let now = Date.UTC(2026, 8, 12)
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { state, httpClient } = fixtureClient()
    await getBzZedMatchup('ahri', { httpClient })
    state.workbook = workbookFixture({ pictures: defaultPictures(8, 'DoransShield') })
    now += BZ_CACHE_TTL + 1
    expect((await getBzZedMatchup('ahri', { httpClient }))?.imageLoadout?.starterItemId).toBe(1054)
  })

  it('never attaches old images to fresh CSV fallback, and recovers images on retry', async () => {
    const { state, httpClient } = fixtureClient()
    await getBzZedMatchup('ahri', { httpClient })
    state.failWorkbook = true
    const fallback = await getBzZedMatchup('ahri', { httpClient, force: true })
    expect(fallback).toMatchObject({
      summary: 'New text',
      sourceFormat: 'csv',
      stale: false,
      imageLoadout: { status: 'unavailable' }
    })
    expect(fallback?.imageLoadout?.spellIds).toBeUndefined()
    expect(resolveBzImageLoadout(fallback!)).toBeNull()
    state.failWorkbook = false
    expect((await getBzZedMatchup('ahri', { httpClient, force: true }))?.imageLoadout?.status).toBe(
      'ready'
    )
  })

  it('keeps stale text readable but excludes old recommendations when both exports fail', async () => {
    const { state, httpClient } = fixtureClient()
    const first = await getBzZedMatchup('ahri', { httpClient })
    state.failWorkbook = state.failCsv = true
    const failed = await getBzZedMatchup('ahri', { httpClient, force: true })
    expect(failed).toMatchObject({
      stale: true,
      fetchedAt: first?.fetchedAt,
      summary: first?.summary
    })
    expect(resolveBzImageLoadout(failed!)).toBeNull()
  })

  it('checks icons against a new patch and removes only unavailable fields', async () => {
    const { state, httpClient } = fixtureClient()
    await getBzZedMatchup('ahri', { httpClient })
    state.version = '16.19.1'
    state.itemIds = [1054]
    const newPatch = await getBzZedMatchup('ahri', { httpClient, force: true })
    expect(newPatch?.imageLoadout).toMatchObject({
      status: 'partial',
      catalogVersion: '16.19.1',
      spellIds: [4, 14],
      issues: [{ code: 'unavailable-in-patch', field: 'starter' }]
    })
    expect(newPatch?.imageLoadout?.starterItemId).toBeUndefined()
    expect(resolveBzImageLoadout(newPatch!)).toEqual({
      spellIds: [4, 14],
      starterItemId: undefined
    })
  })

  it('rejects stale catalogs but recovers without mutating the cached image recognition', async () => {
    const { state, httpClient } = fixtureClient()
    await getBzZedMatchup('ahri', { httpClient })
    state.failSpells = true
    const spellFailure = await getBzZedMatchup('ahri', { httpClient, force: true })
    expect(spellFailure?.imageLoadout?.spellIds).toBeUndefined()
    expect(spellFailure?.imageLoadout?.starterItemId).toBe(1055)
    state.failItems = true
    const catalogFailure = await getBzZedMatchup('ahri', { httpClient, force: true })
    expect(catalogFailure?.imageLoadout?.starterItemId).toBeUndefined()
    expect(resolveBzImageLoadout(catalogFailure!)).toBeNull()
    state.failSpells = state.failItems = false
    expect((await getBzZedMatchup('ahri', { httpClient, force: true }))?.imageLoadout?.status).toBe(
      'ready'
    )
  })
})
