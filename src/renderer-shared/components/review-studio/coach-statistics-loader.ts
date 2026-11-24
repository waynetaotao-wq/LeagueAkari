import type {
  ChampionDataDetails,
  ChampionDataLoadResult,
  ChampionDataQuery
} from '@shared/data-adapter/champion-data'
import type { MatchupBuildParams, MatchupBuildResult } from '@shared/types/counter-intel'

import {
  REVIEW_STATISTICS_POSITION,
  type ReviewLoadoutStatistics,
  normalizeReviewPatch,
  readReviewChampionStatistics,
  readReviewMatchupStatistics,
  selectReviewStatisticsPatch
} from './coach-statistics'
import type { ReviewPosition } from './types'

// [lolps] 给教练资料包取同段位统计：先问来源有哪些版本，再取这个英雄这个位置的通用统计，
// 同时取只看这个对位的那一份。任何一步不成都当作「没有统计」，资料里会照实写明，
// 不会拿别的版本、别的位置的数字顶替而不说。

/** 整个过程最多等这么久；超时就当作没有，免得「开始复盘」一直按不了。 */
export const REVIEW_STATISTICS_TIMEOUT_MS = 15_000
/** 记住最近取过的这么多份，切换页签或回看同一局时不用再取。 */
export const REVIEW_STATISTICS_CACHE_SIZE = 24

export interface ReviewStatisticsRequest {
  championId: number
  opponentChampionId: number | null
  position: ReviewPosition
  /** Patch of the reviewed game, e.g. `16.23`. */
  patch: string
  region: string
  tier: string | number
}

export interface ReviewStatisticsSources {
  loadPatches(
    query: ChampionDataQuery,
    options?: { signal?: AbortSignal }
  ): Promise<ChampionDataLoadResult<string[]>>
  loadDetails(
    query: ChampionDataQuery,
    championId: number,
    options?: { signal?: AbortSignal }
  ): Promise<ChampionDataLoadResult<ChampionDataDetails>>
  /** Statistics of this champion against one opponent only; may reject or say it has none. */
  loadMatchup(params: MatchupBuildParams): Promise<MatchupBuildResult>
}

export const reviewStatisticsKey = (request: ReviewStatisticsRequest) =>
  [
    request.championId,
    request.opponentChampionId ?? 0,
    request.position,
    request.patch,
    request.region,
    request.tier
  ].join(':')

async function load(
  sources: ReviewStatisticsSources,
  request: ReviewStatisticsRequest,
  signal: AbortSignal
): Promise<ReviewLoadoutStatistics | null> {
  const position = REVIEW_STATISTICS_POSITION[request.position]
  if (!position) return null
  const base = {
    source: 'opgg',
    mode: 'ranked',
    region: request.region,
    tier: request.tier
  } satisfies ChampionDataQuery

  const patches = await sources.loadPatches(base, { signal })
  signal.throwIfAborted()
  if (patches.status !== 'success' || patches.effectiveSource !== 'opgg') return null
  const picked = selectReviewStatisticsPatch(patches.data, request.patch)
  if (!picked) return null

  const [details, matchup] = await Promise.all([
    sources.loadDetails({ ...base, patch: picked.patch, position }, request.championId, { signal }),
    request.opponentChampionId === null
      ? null
      : sources
          .loadMatchup({
            myChampionId: request.championId,
            opponentChampionId: request.opponentChampionId,
            position,
            region: request.region,
            tier: request.tier,
            version: picked.patch
          })
          // 对位的那一份是锦上添花，取不到不影响通用统计。
          .catch(() => null)
  ])
  signal.throwIfAborted()
  if (details.status !== 'success' || details.effectiveSource !== 'opgg') return null
  const general = readReviewChampionStatistics(details.data, {
    championId: request.championId,
    position,
    opponentChampionId: request.opponentChampionId
  })
  if (!general) return null
  // 来源答的版本和问的不一样，就以它答的为准，并照实标出是不是这一局的版本。
  const answered = details.data.metadata.patch ?? picked.patch
  const samePatch = selectReviewStatisticsPatch([answered], request.patch)?.samePatch ?? false

  return {
    region: request.region,
    tier: String(request.tier),
    patch: answered,
    samePatch,
    ...general,
    versus:
      request.opponentChampionId === null ||
      !matchup ||
      normalizeReviewPatch(matchup.sourceVersion) !== normalizeReviewPatch(answered)
        ? null
        : readReviewMatchupStatistics(matchup, {
            championId: request.championId,
            opponentChampionId: request.opponentChampionId
          })
  }
}

/** Loads the statistics for one game at a time and remembers recent answers. */
export class ReviewStatisticsLoader {
  private readonly _cache = new Map<string, ReviewLoadoutStatistics>()

  constructor(
    private readonly _sources: ReviewStatisticsSources,
    private readonly _timeoutMs = REVIEW_STATISTICS_TIMEOUT_MS
  ) {}

  /** An answer loaded earlier; undefined when this request has not succeeded yet. */
  peek(request: ReviewStatisticsRequest) {
    return this._cache.get(reviewStatisticsKey(request))
  }

  /** null when the statistics cannot be had; never rejects, aborting included. */
  async load(
    request: ReviewStatisticsRequest,
    signal?: AbortSignal
  ): Promise<ReviewLoadoutStatistics | null> {
    const key = reviewStatisticsKey(request)
    const cached = this._cache.get(key)
    if (cached) return cached

    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), this._timeoutMs)
    const bounded = signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal
    try {
      const statistics = await Promise.race([
        load(this._sources, request, bounded),
        // 请求本身不一定理会取消，所以这里自己停止等待。
        new Promise<null>((resolve) =>
          bounded.addEventListener('abort', () => resolve(null), { once: true })
        )
      ])
      if (statistics && !bounded.aborted) {
        this._cache.set(key, statistics)
        while (this._cache.size > REVIEW_STATISTICS_CACHE_SIZE)
          this._cache.delete(this._cache.keys().next().value!)
      }
      return statistics
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  }
}
