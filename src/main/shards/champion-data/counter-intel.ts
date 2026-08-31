import type { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type {
  BzGuideParams,
  BzGuideResult,
  CounterIntelParams,
  CounterIntelResult,
  CounterIntelRow,
  MatchupBuildParams,
  MatchupBuildResult,
  RolePriors
} from '@shared/types/counter-intel'
import type { PositionType, RegionType, TierType } from '@shared/types/opgg'
import type { LaneName } from '@shared/utils/lane-assignment'
import type { AxiosInstance } from 'axios'

import type { AkariIpcMain } from '../ipc'
import type { AkariLogger } from '../logger-factory'
import { getBzZedMatchup } from './bz-guide'
import {
  type ChampionSlugInfo,
  LANE_KILL_TARGET_COUNT,
  fetchChampionSlugMap,
  fetchLaneKillRates
} from './counter-intel-web'
import {
  buildVerifiedMatchupOverlay,
  isPlausibleMatchupBuild,
  resolveComparableMatchupGames
} from './matchup-build'

/**
 * 对位克制助手（Counter Intel）
 *
 * 混合数据架构：
 *   - 整体胜率：OP.GG 官方 JSON 接口（champion 详情的 counters 字段），零维护自动更新
 *   - 单杀率：OP.GG 网页 RSC 通道（见 counter-intel-web.ts），失败时优雅降级
 *   - 分路先验：OP.GG 官方梯队接口的各位置场次占比，用于全队分路指派推断
 *
 * 挂载在 champion-data 模块内，复用其 IPC 命名空间与 HTTP 客户端体系。
 */

const INTEL_CACHE_TTL = 8 * 60 * 1000
const MATCHUP_CACHE_TTL = 10 * 60 * 1000
const PRIORS_CACHE_TTL = 10 * 60 * 1000
const SLUG_CACHE_TTL = 6 * 60 * 60 * 1000

const UNIFIED_TO_OPGG_POSITION: Readonly<Record<LaneName, PositionType>> = {
  top: 'top',
  jungle: 'jungle',
  middle: 'mid',
  bottom: 'adc',
  utility: 'support'
}

const OPGG_POSITION_TO_UNIFIED: Readonly<Record<string, LaneName>> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MID: 'middle',
  ADC: 'bottom',
  SUPPORT: 'utility'
}

interface CacheEntry<T> {
  expiresAt: number
  value: T
}

export class ChampionDataCounterIntel {
  private _slugCache: CacheEntry<Map<number, ChampionSlugInfo>> | null = null
  private _priorsCache = new Map<string, CacheEntry<RolePriors>>()
  private _intelCache = new Map<string, CacheEntry<CounterIntelResult>>()
  private _matchupCache = new Map<string, CacheEntry<MatchupBuildResult>>()
  private _inflight = new Map<number, AbortController>()

  constructor(
    private readonly _deps: {
      logger: AkariLogger
      opggApi: OpggHttpApiAxiosHelper
      web: AxiosInstance
    }
  ) {}

  register(ipc: AkariIpcMain, namespace: string) {
    ipc.onCall(namespace, 'counterIntel/get', (event: any, params: CounterIntelParams) =>
      this.get(event?.sender?.id ?? 0, params)
    )
    ipc.onCall(
      namespace,
      'counterIntel/rolePriors',
      (_event: any, region: string, tier: string | number, version: string | null) =>
        this.getRolePriors(region, tier, version)
    )
    ipc.onCall(namespace, 'counterIntel/bzGuide', async (_event: any, params: BzGuideParams) => {
      const opponentChampionId = Number(params?.opponentChampionId)
      if (!Number.isFinite(opponentChampionId) || opponentChampionId <= 0) {
        return {
          found: false,
          row: null,
          reason: 'invalid-opponent'
        } satisfies BzGuideResult
      }
      const slug = await this.getChampionSlug(opponentChampionId)
      if (!slug) {
        this._deps.logger.warn(`[BzGuide] 未找到英雄 ${opponentChampionId} 的 slug`)
        return {
          found: false,
          row: null,
          reason: 'slug-unavailable'
        } satisfies BzGuideResult
      }
      try {
        const row = await getBzZedMatchup(slug, {
          httpClient: this._deps.web,
          includeCoreItems: params?.includeCoreItems !== false,
          onWarn: (message) => this._deps.logger.warn(`[BzGuide] ${message}`)
        })
        return {
          found: !!row,
          row,
          reason: row ? undefined : 'not-found'
        } satisfies BzGuideResult
      } catch (error: any) {
        this._deps.logger.warn(
          `[BzGuide] 获取 ${slug} 攻略失败: ${error?.message ?? String(error)}`
        )
        return {
          found: false,
          row: null,
          reason: 'source-unavailable'
        } satisfies BzGuideResult
      }
    })

    ipc.onCall(namespace, 'counterIntel/matchupBuild', (_event: any, params: MatchupBuildParams) =>
      this.getMatchupBuild(params)
    )
  }

  dispose() {
    for (const controller of this._inflight.values()) {
      controller.abort()
    }
    this._inflight.clear()
  }

  private _toApiRegion(region: string): RegionType {
    return (region && region.length > 0 ? region : 'global') as RegionType
  }

  private _toApiTier(tier: string | number): TierType | undefined {
    return typeof tier === 'string' && tier.length > 0 ? (tier as TierType) : undefined
  }

  private _assertRequestedVersion(
    requestedVersion: string | null,
    sourceVersion: string | null | undefined,
    context: string
  ) {
    if (requestedVersion && sourceVersion !== requestedVersion) {
      throw new Error(
        `OP.GG ${context}补丁不匹配 (expected=${requestedVersion}, actual=${sourceVersion ?? '?'})`
      )
    }
  }

  private async _ensureSlugMap(signal?: AbortSignal): Promise<Map<number, ChampionSlugInfo>> {
    const now = Date.now()
    if (this._slugCache && this._slugCache.expiresAt > now) {
      return this._slugCache.value
    }
    const map = await fetchChampionSlugMap(this._deps.web, signal)
    this._slugCache = { expiresAt: now + SLUG_CACHE_TTL, value: map }
    return map
  }

  /** [lolps] 对外暴露：查某英雄的 OP.GG slug（英文名同源），Bz 攻略匹配用 */
  async getChampionSlug(championId: number): Promise<string | null> {
    try {
      const map = await this._ensureSlugMap()
      return map.get(championId)?.slug ?? null
    } catch {
      return null
    }
  }

  async getRolePriors(
    region: string,
    tier: string | number,
    version: string | null = null
  ): Promise<RolePriors> {
    const requestedVersion = version?.trim() || null
    const key = `${region}|${tier}|${requestedVersion ?? 'latest'}`
    const now = Date.now()
    const cached = this._priorsCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.value
    }
    const response = await this._deps.opggApi.getChampions(this._toApiRegion(region), 'ranked', {
      tier: this._toApiTier(tier),
      version: requestedVersion ?? undefined
    })
    this._assertRequestedVersion(requestedVersion, response.data.meta?.version, '分路先验')
    const priors: RolePriors = {}
    for (const item of response.data.data) {
      const plays: Partial<Record<LaneName, number>> = {}
      let total = 0
      for (const position of item.positions ?? []) {
        const lane = OPGG_POSITION_TO_UNIFIED[position.name]
        if (!lane) continue
        const play = position.stats?.play ?? 0
        plays[lane] = play
        total += play
      }
      if (total <= 0) continue
      const shares: Partial<Record<LaneName, number>> = {}
      for (const [lane, play] of Object.entries(plays) as [LaneName, number][]) {
        shares[lane] = play / total
      }
      priors[item.id] = shares
    }
    this._priorsCache.set(key, { expiresAt: now + PRIORS_CACHE_TTL, value: priors })
    return priors
  }

  async get(senderId: number, params: CounterIntelParams): Promise<CounterIntelResult> {
    const requestedVersion = params.version?.trim() || null
    const key = `${params.championId}|${params.position}|${params.region}|${params.tier}|${requestedVersion ?? 'latest'}`
    const now = Date.now()
    const cached = this._intelCache.get(key)
    if (!params.force && cached && cached.expiresAt > now) {
      return cached.value
    }

    this._inflight.get(senderId)?.abort()
    const controller = new AbortController()
    this._inflight.set(senderId, controller)
    const signal = controller.signal

    try {
      const apiPosition = UNIFIED_TO_OPGG_POSITION[params.position]
      const response = await this._deps.opggApi.getChampion(
        this._toApiRegion(params.region),
        'ranked',
        params.championId,
        apiPosition,
        {
          tier: this._toApiTier(params.tier),
          version: requestedVersion ?? undefined,
          signal
        }
      )
      this._assertRequestedVersion(requestedVersion, response.data.meta?.version, '克制表')
      const counters = response.data.data.counters ?? []
      const rowsBase = counters
        .filter((item) => item.play > 0)
        .map((item) => ({
          championId: item.champion_id,
          games: item.play,
          // counters 中 win 为「对位英雄」的胜场 → 我方候选胜率取补
          myWinRate: 1 - item.win / item.play
        }))

      let laneKillAvailable = false
      const laneKillByChampion = new Map<
        number,
        { enemyPercent: number; minePercent: number } | null
      >()

      try {
        const slugMap = await this._ensureSlugMap(signal)
        const baseSlug = slugMap.get(params.championId)?.slug
        if (!baseSlug) {
          throw new Error(`未找到英雄 ${params.championId} 的 OP.GG slug`)
        }
        const targets = [...rowsBase]
          .sort((a, b) => b.games - a.games)
          .slice(0, LANE_KILL_TARGET_COUNT)
          .map((row) => ({ championId: row.championId, slug: slugMap.get(row.championId)?.slug }))
          .filter((t): t is { championId: number; slug: string } => Boolean(t.slug))

        const fetched = await fetchLaneKillRates(this._deps.web, {
          baseSlug,
          position: params.position,
          region: params.region,
          tier: params.tier,
          patch: requestedVersion,
          targets,
          signal,
          onWarn: (message) => this._deps.logger.warn(`[CounterIntel] ${message}`)
        })
        for (const [championId, pair] of fetched) {
          laneKillByChampion.set(championId, pair)
          if (pair) {
            laneKillAvailable = true
          }
        }
      } catch (error: any) {
        if (signal.aborted) {
          throw error
        }
        this._deps.logger.warn(
          `[CounterIntel] 单杀率通道整体失败, 已降级为仅胜率: ${error?.message ?? error}`
        )
      }

      const rows: CounterIntelRow[] = rowsBase.map((row) => {
        const pair = laneKillByChampion.get(row.championId)
        return {
          championId: row.championId,
          games: row.games,
          myWinRate: row.myWinRate,
          laneKillRate: pair ? pair.minePercent / 100 : null,
          enemyLaneKillRate: pair ? pair.enemyPercent / 100 : null
        }
      })

      const result: CounterIntelResult = {
        championId: params.championId,
        position: params.position,
        region: params.region,
        tier: params.tier,
        version: requestedVersion,
        updatedAt: new Date().toISOString(),
        laneKillAvailable,
        rows
      }
      this._intelCache.set(key, { expiresAt: Date.now() + INTEL_CACHE_TTL, value: result })
      return result
    } finally {
      if (this._inflight.get(senderId) === controller) {
        this._inflight.delete(senderId)
      }
    }
  }

  /**
   * [lolps] 对位构筑 v3：OP.GG target_champion JSON 一次返回完整对位数据。
   * 请求、缓存和结果同时绑定地区/段位/位置/补丁；未经样本校验绝不下发 overlay。
   */
  async getMatchupBuild(params: MatchupBuildParams): Promise<MatchupBuildResult> {
    const requestedVersion = params.version?.trim() || null
    const key = `${params.myChampionId}|${params.opponentChampionId}|${params.position}|${params.region}|${params.tier}|${requestedVersion ?? 'latest'}`
    const now = Date.now()
    const cached = this._matchupCache.get(key)
    if (!params.force && cached && cached.expiresAt > now) {
      return cached.value
    }

    const apiPosition = UNIFIED_TO_OPGG_POSITION[params.position]
    const commonOptions = {
      tier: this._toApiTier(params.tier),
      version: requestedVersion ?? undefined
    }
    // target 响应本身不回显目标 id；同口径取一份无 target 基线，防止服务端忽略参数却仍 200。
    const [response, genericResponse] = await Promise.all([
      this._deps.opggApi.getChampion(
        this._toApiRegion(params.region),
        'ranked',
        params.myChampionId,
        apiPosition,
        { ...commonOptions, targetChampion: params.opponentChampionId }
      ),
      this._deps.opggApi.getChampion(
        this._toApiRegion(params.region),
        'ranked',
        params.myChampionId,
        apiPosition,
        commonOptions
      )
    ])
    const data = response.data.data
    const genericData = genericResponse.data.data
    const sourceVersion = response.data.meta?.version || null
    if (data.summary.id !== params.myChampionId) {
      throw new Error(
        `OP.GG 返回英雄不匹配 (expected=${params.myChampionId}, actual=${data.summary.id})`
      )
    }
    this._assertRequestedVersion(requestedVersion, sourceVersion, '对位构筑')
    if (genericData.summary.id !== params.myChampionId) {
      throw new Error(
        `OP.GG 基线英雄不匹配 (expected=${params.myChampionId}, actual=${genericData.summary.id})`
      )
    }
    this._assertRequestedVersion(
      requestedVersion,
      genericResponse.data.meta?.version,
      '对位构筑基线'
    )
    const genericSourceVersion = genericResponse.data.meta?.version || null
    if (!sourceVersion || !genericSourceVersion || sourceVersion !== genericSourceVersion) {
      throw new Error(
        `OP.GG 对位与基线补丁不一致 (target=${sourceVersion ?? '?'}, baseline=${genericSourceVersion ?? '?'})`
      )
    }

    // counters[].win 始终是“被请求的基准英雄”胜场；这里基准就是我方英雄，不能取补。
    const readMatchupMeta = (source: typeof data): MatchupBuildResult['meta'] => {
      const positionCounters = source.summary.positions?.find(
        (position) => position.name.toLowerCase() === apiPosition.toLowerCase()
      )?.counters
      const counters = source.counters?.length ? source.counters : (positionCounters ?? [])
      const hit = counters.find((item) => item.champion_id === params.opponentChampionId)
      return hit && hit.play > 0 && hit.win >= 0 && hit.win <= hit.play
        ? { play: hit.play, win: hit.win }
        : null
    }
    const meta = readMatchupMeta(data)
    const genericMeta = readMatchupMeta(genericData)
    const matchupGames =
      meta && genericMeta ? resolveComparableMatchupGames(meta.play, genericMeta.play) : null

    let overlay: MatchupBuildResult['overlay'] = null
    let parsedSections: string[] = []
    let targetVerified = false
    if (meta && matchupGames && isPlausibleMatchupBuild(data, matchupGames)) {
      const built = buildVerifiedMatchupOverlay(data, genericData, matchupGames)
      parsedSections = built.parsedSections
      targetVerified = parsedSections.length >= 2
      overlay = targetVerified ? (built.overlay as unknown as Record<string, unknown>) : null
    }

    if (targetVerified) {
      this._deps.logger.info(
        `[MatchupBuild] ${params.myChampionId} vs ${params.opponentChampionId}@${params.position} region=${params.region} tier=${params.tier} version=${sourceVersion ?? 'latest'}: sections=[${parsedSections.join(', ')}]`
      )
    } else {
      this._deps.logger.warn(
        `[MatchupBuild] 拒绝未验证对位数据（counters 锚点不可比，或至少两区未与通用 cohort 显著分离）: my=${params.myChampionId} opp=${params.opponentChampionId} games=${meta?.play ?? 0} baselineGames=${genericMeta?.play ?? 0}`
      )
    }

    const result: MatchupBuildResult = {
      myChampionId: params.myChampionId,
      opponentChampionId: params.opponentChampionId,
      position: params.position,
      region: params.region,
      tier: params.tier,
      version: requestedVersion,
      sourceVersion,
      meta,
      overlay,
      parsedSections,
      targetVerified,
      updatedAt: new Date().toISOString()
    }
    // 拒绝/空样本不缓存，避免第三方短暂异常把诚实回退固定十分钟。
    if (targetVerified) {
      this._matchupCache.set(key, { expiresAt: Date.now() + MATCHUP_CACHE_TTL, value: result })
      if (this._matchupCache.size > 40) {
        const oldest = this._matchupCache.keys().next().value
        if (oldest !== undefined) {
          this._matchupCache.delete(oldest)
        }
      }
    }
    return result
  }
}
