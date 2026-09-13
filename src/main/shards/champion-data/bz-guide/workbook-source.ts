import type { BzMatchupRow } from '@shared/types/counter-intel'
import type { AxiosInstance } from 'axios'

import {
  type BzWorkbookSnapshot,
  createBzSnapshot,
  readBzSnapshot,
  writeBzSnapshot
} from './snapshot'
import { BzGuideDataValidationError, canonicalName } from './table'
import { BZ_WORKBOOK_MAX_BYTES, parseBzWorkbook } from './workbook'

interface WorkbookState {
  table: Map<string, BzMatchupRow>
  fetchedAt: number
  stale: boolean
  expiresAt: number
  reference: BzWorkbookSnapshot
  inFlight?: Promise<void>
}
interface WorkbookSourceOptions {
  url: string
  ttl: number
  force?: boolean
  background?: boolean
  snapshotFile?: string
  loadText: () => Promise<Map<string, BzMatchupRow>>
  onWarn?: (message: string) => void
  onUpdated?: () => void
}
const states = new WeakMap<AxiosInstance, Promise<WorkbookState>>()

/** One download for all windows. A successful public workbook survives restarts. */
export async function readBzWorkbook(http: AxiosInstance, options: WorkbookSourceOptions) {
  let pending = states.get(http)
  if (!pending) {
    pending = readBzSnapshot(options.snapshotFile).then((reference) => ({
      table: new Map(reference.rows.map((row) => [canonicalName(row.champion), row])),
      fetchedAt: reference.fetchedAt,
      stale: true,
      expiresAt: 0,
      reference
    }))
    states.set(http, pending)
  }
  const state = await pending
  if (!state.inFlight && (options.force || Date.now() >= state.expiresAt)) {
    if (Date.now() - state.fetchedAt >= options.ttl) state.stale = true
    state.inFlight = refreshWorkbook(http, state, options).finally(() => {
      state.inFlight = undefined
      // Notify after replacing the complete snapshot, including freshness and retry metadata.
      options.onUpdated?.()
    })
  }
  if (!options.background) await state.inFlight
  return {
    table: state.table,
    fetchedAt: state.fetchedAt,
    stale: state.stale,
    refreshing: !!state.inFlight,
    reference: state.reference
  }
}

async function refreshWorkbook(
  http: AxiosInstance,
  state: WorkbookState,
  options: WorkbookSourceOptions
) {
  try {
    const { data } = await http.get<ArrayBuffer>(options.url, {
      responseType: 'arraybuffer',
      timeout: 30_000,
      maxContentLength: BZ_WORKBOOK_MAX_BYTES,
      'axios-retry': { retries: 1 }
    })
    const bytes = Buffer.isBuffer(data)
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : null
    if (!bytes) throw new BzGuideDataValidationError('BZ Excel response is not binary')
    const rows = parseBzWorkbook(bytes)
    const fetchedAt = Date.now()
    const reference = createBzSnapshot(rows, fetchedAt)
    state.table = new Map(rows.map((row) => [canonicalName(row.champion), row]))
    state.fetchedAt = fetchedAt
    state.stale = false
    state.reference = reference
    state.expiresAt = fetchedAt + options.ttl
    if (options.snapshotFile) {
      await writeBzSnapshot(options.snapshotFile, reference).catch((error: unknown) => {
        options.onWarn?.(`已读取在线图片，但本地记录保存失败: ${String(error)}`)
      })
    }
  } catch (error) {
    options.onWarn?.(`图片表读取失败，自动展示已核对记录并重试: ${String(error)}`)
    try {
      const table = await options.loadText()
      for (const row of table.values())
        row.imageLoadout = {
          status: 'unavailable',
          issues: [{ code: 'source-unavailable', field: 'both' }]
        }
      state.table = table
      state.fetchedAt = Date.now()
      state.stale = false
    } catch {
      state.stale = true
    }
    state.expiresAt = Date.now() + 60_000
  }
}
