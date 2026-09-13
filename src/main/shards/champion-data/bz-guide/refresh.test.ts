import { resolveBzDisplayedLoadout, resolveBzImageLoadout } from '@shared/utils/bz-image-loadout'
import type { AxiosInstance } from 'axios'
import { mkdtemp, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { defaultPictures, workbookFixture } from './fixtures/workbook'
import {
  BZ_CACHE_TTL,
  BZ_CSV_URL,
  BZ_XLSX_URL,
  getBzKnownChampionSlug,
  getBzZedMatchup
} from './index'
import bundled from './verified-snapshot.json'

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

const snapshotDirectories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const directory of snapshotDirectories.splice(0)) {
    await rm(join(directory, 'record.json'), { force: true })
    await rm(join(directory, 'record.json.tmp'), { force: true })
    await rmdir(directory)
  }
})

describe('Bz image refresh to recommendation flow', () => {
  it('can identify every bundled opponent and display its own recorded images without OP.GG or Google', async () => {
    const { state, httpClient } = fixtureClient()
    state.spellIds = [1, 3, 4, 12, 14]
    state.failWorkbook = state.failCsv = true
    const found: string[] = []
    let completeImages = 0
    for (const id of Object.keys(bundled.championSlugs)) {
      const slug = getBzKnownChampionSlug(Number(id))
      expect(slug).not.toBeNull()
      const row = await getBzZedMatchup(slug!, { httpClient })
      expect(row?.imageReference).toBeDefined()
      found.push(row!.champion)
      const display = resolveBzDisplayedLoadout(row!)
      if (display?.spellIds && display.starterItemId) completeImages++
    }
    expect(new Set(found)).toEqual(new Set(bundled.rows.map((row) => row.champion)))
    expect(completeImages).toBe(
      bundled.rows.filter((row) => row.imageLoadout.status === 'ready').length
    )
    expect(getBzKnownChampionSlug(-1)).toBeNull()
  })
  it('shows verified images before slow network requests finish, then notifies and replaces them automatically', async () => {
    const { state, httpClient, get } = fixtureClient()
    state.workbook = workbookFixture({ pictures: defaultPictures(8, 'DoransShield') })
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = get.getMockImplementation()!
    get.mockImplementation(async (url) => {
      await gate
      return original(url)
    })
    const onUpdated = vi.fn()
    const first = await getBzZedMatchup('ahri', { httpClient, backgroundRefresh: true, onUpdated })
    expect(first).toMatchObject({
      stale: true,
      refreshing: true,
      imageReference: { reason: 'refreshing' }
    })
    expect(resolveBzDisplayedLoadout(first!)).toEqual({ spellIds: [4, 14], starterItemId: 1055 })
    expect(resolveBzImageLoadout(first!)).toBeNull()
    release()
    await vi.waitFor(() => expect(onUpdated).toHaveBeenCalledOnce())
    const current = await getBzZedMatchup('ahri', {
      httpClient,
      backgroundRefresh: true,
      onUpdated
    })
    expect(current?.imageReference).toBeUndefined()
    expect(current).toMatchObject({
      stale: false,
      refreshing: false,
      imageLoadout: { starterItemId: 1054 }
    })
    expect(get.mock.calls.filter(([url]) => url === BZ_XLSX_URL)).toHaveLength(1)
  })

  it('automatically shows the verified snapshot on a first-run outage and recovers after backoff', async () => {
    let now = bundled.fetchedAt + 60_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    const { state, httpClient, get } = fixtureClient()
    state.failWorkbook = true
    const failed = await getBzZedMatchup('ahri', { httpClient })
    expect(failed).toMatchObject({
      sourceFormat: 'csv',
      summary: 'New text',
      imageReference: { fetchedAt: bundled.fetchedAt }
    })
    expect(resolveBzDisplayedLoadout(failed!)?.spellIds).toEqual([4, 14])
    expect(resolveBzImageLoadout(failed!)).toBeNull()
    await getBzZedMatchup('ahri', { httpClient })
    expect(get.mock.calls.filter(([url]) => url === BZ_XLSX_URL)).toHaveLength(1)
    state.failWorkbook = false
    state.workbook = workbookFixture({ pictures: defaultPictures(8, 'DoransShield') })
    now += 60_001
    const recovered = await getBzZedMatchup('ahri', { httpClient })
    expect(recovered?.imageReference).toBeUndefined()
    expect(resolveBzImageLoadout(recovered!)?.starterItemId).toBe(1054)
  })

  it('retains the latest successful image change across restarts, and ignores corrupt cache files', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'akari-bz-'))
    snapshotDirectories.push(directory)
    const snapshotFile = join(directory, 'record.json')
    const { state, httpClient } = fixtureClient()
    state.workbook = workbookFixture({ pictures: defaultPictures(8, 'DoransShield') })
    await getBzZedMatchup('ahri', { httpClient, snapshotFile })
    const offline = fixtureClient()
    offline.state.failWorkbook = offline.state.failCsv = true
    const cached = await getBzZedMatchup('ahri', { httpClient: offline.httpClient, snapshotFile })
    expect(resolveBzDisplayedLoadout(cached!)?.starterItemId).toBe(1054)
    expect(resolveBzImageLoadout(cached!)).toBeNull()
    await writeFile(snapshotFile, '{broken')
    const restarted = fixtureClient()
    restarted.state.failWorkbook = restarted.state.failCsv = true
    const fallback = await getBzZedMatchup('ahri', {
      httpClient: restarted.httpClient,
      snapshotFile
    })
    expect(resolveBzDisplayedLoadout(fallback!)?.starterItemId).toBe(1055)
  })

  it('never completes an ambiguous live row with the bundled reference', async () => {
    const { state, httpClient } = fixtureClient()
    state.workbook = workbookFixture({
      pictures: [...defaultPictures(8), { ...defaultPictures(8)[1], x: 60 }]
    })
    const row = await getBzZedMatchup('ahri', { httpClient })
    expect(row?.imageLoadout?.status).toBe('partial')
    expect(row?.imageReference).toBeUndefined()
    expect(resolveBzDisplayedLoadout(row!)?.spellIds).toBeUndefined()
  })

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

  it('does not reintroduce removed spells or items through a saved reference after an image-source outage', async () => {
    const { state, httpClient } = fixtureClient()
    await getBzZedMatchup('ahri', { httpClient })
    state.failWorkbook = true
    state.version = '16.19.1'
    state.spellIds = [4]
    state.itemIds = [1054]
    const row = await getBzZedMatchup('ahri', { httpClient, force: true })
    expect(row?.imageReference).toBeDefined()
    expect(resolveBzDisplayedLoadout(row!)).toEqual({
      spellIds: undefined,
      starterItemId: undefined
    })
    expect(resolveBzImageLoadout(row!)).toBeNull()
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
