import type { ChampionDataRenderer } from '@renderer-shared/shards/champion-data'
import type { ChampionDataDetails, ChampionDataQuery } from '@shared/data-adapter/champion-data'

import type { DraftRole, MatchupSample } from './model'

type DataSource = Pick<ChampionDataRenderer, 'loadPatches' | 'loadDetails'>
export interface DraftMatchups {
  patch: string | null
  samples: Record<number, MatchupSample[]>
  failed: number[]
}

const QUERY = {
  source: 'opgg',
  mode: 'ranked',
  region: 'kr',
  tier: 'emerald_plus'
} satisfies ChampionDataQuery
const CACHE_TTL = 5 * 60_000

export function readMatchupSamples(
  data: ChampionDataDetails,
  championId: number,
  role: DraftRole,
  patch: string
): MatchupSample[] | null {
  if (
    data.metadata.source !== 'opgg' ||
    data.metadata.mode !== 'ranked' ||
    data.metadata.patch !== patch ||
    data.championId !== championId ||
    data.summary.championId !== championId ||
    data.summary.position !== role ||
    !data.sections.positions?.some((position) => position.position === role) ||
    !Array.isArray(data.sections.matchups)
  )
    return null
  const duplicates = new Set<number>()
  const seen = new Set<number>()
  const result: MatchupSample[] = []
  for (const row of data.sections.matchups) {
    if (seen.has(row.championId)) duplicates.add(row.championId)
    seen.add(row.championId)
    const { games, wins } = row.performance
    if (
      !Number.isInteger(row.championId) ||
      row.championId <= 0 ||
      row.championId === championId ||
      games === null ||
      wins === null ||
      !Number.isSafeInteger(games) ||
      !Number.isSafeInteger(wins) ||
      games <= 0 ||
      wins < 0 ||
      wins > games
    )
      continue
    result.push({ championId: row.championId, games, wins })
  }
  return result.filter((row) => !duplicates.has(row.championId))
}

/** Per-panel cache. At most two public requests at once; identities never leave this feature. */
export class DraftMatchupLoader {
  private _patch: { value: string; at: number } | null = null
  private readonly _cache = new Map<string, { at: number; samples: MatchupSample[] }>()

  constructor(private readonly _source: DataSource) {}

  clear() {
    this._patch = null
    this._cache.clear()
  }

  async load(role: DraftRole, championIds: number[], signal: AbortSignal): Promise<DraftMatchups> {
    signal.throwIfAborted()
    const timeout = AbortSignal.timeout(30_000)
    const boundedSignal = AbortSignal.any([signal, timeout])
    const options = { signal: boundedSignal }
    if (!this._patch || Date.now() - this._patch.at > CACHE_TTL) {
      const result = await this._source.loadPatches(QUERY, options)
      boundedSignal.throwIfAborted()
      const patch =
        result.status === 'success' && result.effectiveSource === 'opgg' ? result.data[0] : null
      if (!patch || !/^\d+\.\d+(?:\.\d+)?$/.test(patch))
        return { patch: null, samples: {}, failed: championIds }
      this._patch = { value: patch, at: Date.now() }
    }
    const patch = this._patch.value
    const output: DraftMatchups = { patch, samples: {}, failed: [] }
    const pending = [...new Set(championIds)].slice(0, 10)
    await Promise.all(
      Array.from({ length: Math.min(2, pending.length) }, async () => {
        while (pending.length) {
          boundedSignal.throwIfAborted()
          const championId = pending.shift()!
          const key = `${patch}:${role}:${championId}`
          const cached = this._cache.get(key)
          if (cached && Date.now() - cached.at <= CACHE_TTL) {
            output.samples[championId] = cached.samples
            continue
          }
          try {
            const result = await this._source.loadDetails(
              { ...QUERY, patch, position: role },
              championId,
              options
            )
            boundedSignal.throwIfAborted()
            const samples =
              result.status === 'success' && result.effectiveSource === 'opgg'
                ? readMatchupSamples(result.data, championId, role, patch)
                : null
            if (samples) {
              this._cache.set(key, { at: Date.now(), samples })
              output.samples[championId] = samples
            } else output.failed.push(championId)
          } catch (error) {
            if (boundedSignal.aborted) throw error
            output.failed.push(championId)
          }
        }
      })
    )
    boundedSignal.throwIfAborted()
    // Keep the cache bounded across repeated lane changes and champion pools.
    while (this._cache.size > 60) this._cache.delete(this._cache.keys().next().value!)
    return output
  }
}
