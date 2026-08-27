import type {
  CounterIntelParams,
  CounterIntelResult,
  CounterIntelRow,
  MatchupBuildParams,
  MatchupBuildResult,
  RolePriors
} from '@shared/types/counter-intel'
import type { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type { PositionType, RegionType, TierType } from '@shared/types/opgg'
import type { LaneName } from '@shared/utils/lane-assignment'
import type { AxiosInstance } from 'axios'

import type { AkariIpcMain } from '../ipc'
import type { AkariLogger } from '../logger-factory'
import {
  type ChampionSlugInfo,
  LANE_KILL_TARGET_COUNT,
  fetchChampionSlugMap,
  fetchLaneKillRates
} from './counter-intel-web'
import { buildMatchupPageUrl, fetchMatchupPage } from './matchup-build'

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
    ipc.onCall(namespace, 'counterIntel/rolePriors', (_event: any, region: string, tier: string | number) =>
      this.getRolePriors(region, tier)
    )
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

  private async _ensureSlugMap(signal?: AbortSignal): Promise<Map<number, ChampionSlugInfo>> {
    const now = Date.now()
    if (this._slugCache && this._slugCache.expiresAt > now) {
      return this._slugCache.value
    }
    const map = await fetchChampionSlugMap(this._deps.web, signal)
    this._slugCache = { expiresAt: now + SLUG_CACHE_TTL, value: map }
    return map
  }

  async getRolePriors(region: string, tier: string | number): Promise<RolePriors> {
    const key = `${region}|${tier}`
    const now = Date.now()
    const cached = this._priorsCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.value
    }
    const response = await this._deps.opggApi.getChampions(this._toApiRegion(region), 'ranked', {
      tier: this._toApiTier(tier)
    })
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
    const key = `${params.championId}|${params.position}|${params.region}|${params.tier}`
    const now = Date.now()
    const cached = this._intelCache.get(key)
    if (cached && cached.expiresAt > now) {
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
        { tier: this._toApiTier(params.tier), signal }
      )
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
   * [lolps] 对位构筑：抓取「我的英雄 × 对位英雄」的专属符文 / 召唤师 / 出装。
   * 网页解析失败时 pageParsed=false 并保留 meta（官方接口的对位场次与胜场）。
   */
  async getMatchupBuild(params: MatchupBuildParams): Promise<MatchupBuildResult> {
    const key = `${params.myChampionId}|${params.opponentChampionId}|${params.position}|${params.region}|${params.tier}`
    const now = Date.now()
    const cached = this._matchupCache.get(key)
    if (cached && cached.expiresAt > now) {
      return cached.value
    }

    const slugMap = await this._ensureSlugMap()
    const mySlug = slugMap.get(params.myChampionId)?.slug
    const opponentSlug = slugMap.get(params.opponentChampionId)?.slug
    if (!mySlug || !opponentSlug) {
      throw new Error(
        `未找到英雄 slug (my=${params.myChampionId}:${mySlug ?? '?'}, opp=${params.opponentChampionId}:${opponentSlug ?? '?'})`
      )
    }

    // 元信息：官方接口 counters 字段（play=对局数, win 为对位英雄胜场 → 我方胜场取补）
    let meta: MatchupBuildResult['meta'] = null
    try {
      const apiPosition = UNIFIED_TO_OPGG_POSITION[params.position]
      const response = await this._deps.opggApi.getChampion(
        this._toApiRegion(params.region),
        'ranked',
        params.myChampionId,
        apiPosition,
        { tier: this._toApiTier(params.tier) }
      )
      const counters = response.data.data.counters ?? []
      const hit = counters.find((item) => item.champion_id === params.opponentChampionId)
      if (hit && hit.play > 0) {
        meta = { play: hit.play, win: hit.play - hit.win }
      }
    } catch (error: any) {
      this._deps.logger.info(`[MatchupBuild] 元信息获取失败(不致命): ${error?.message ?? error}`)
    }

    // 网页通道：对位专属构筑
    let runePages: MatchupBuildResult['runePages'] = []
    let sections: MatchupBuildResult['sections'] = []
    let pageParsed = false
    const url = buildMatchupPageUrl({
      mySlug,
      opponentSlug,
      position: params.position,
      region: params.region,
      tier: typeof params.tier === 'string' ? params.tier : String(params.tier ?? '')
    })
    try {
      const page = await fetchMatchupPage(this._deps.web, url)
      runePages = page.runePages
      sections = page.sections
      pageParsed = runePages.length > 0 || sections.length > 0
      this._deps.logger.info(
        `[MatchupBuild] ${mySlug} vs ${opponentSlug}@${params.position}: runePages=${runePages.length}, sections=[${sections
          .map((s) => `${s.key}:${s.entries.length}`)
          .join(', ')}]`
      )
    } catch (error: any) {
      this._deps.logger.warn(
        `[MatchupBuild] 网页解析失败(已降级): ${error?.message ?? error} | url: ${url}`
      )
    }

    const result: MatchupBuildResult = {
      myChampionId: params.myChampionId,
      opponentChampionId: params.opponentChampionId,
      position: params.position,
      region: params.region,
      tier: params.tier,
      meta,
      runePages,
      sections,
      pageParsed,
      updatedAt: new Date().toISOString()
    }
    this._matchupCache.set(key, { expiresAt: Date.now() + MATCHUP_CACHE_TTL, value: result })
    if (this._matchupCache.size > 40) {
      const oldest = this._matchupCache.keys().next().value
      if (oldest !== undefined) {
        this._matchupCache.delete(oldest)
      }
    }
    return result
  }
}
