import {
  type ChampionDataDetails,
  type ChampionDataOverview,
  type ChampionDataPosition,
  type ChampionDataQuery,
  type ChampionDataSourceId,
  type Qq101MayhemInput,
  type Qq101RankedDetailsInput,
  adaptLolpsChampionDetails,
  adaptLolpsChampionOverview,
  adaptOpggChampionDetails,
  adaptOpggChampionOverview,
  adaptOpggMayhemDetails,
  adaptOpggMayhemOverview,
  adaptQq101ClassicOverview,
  adaptQq101MayhemDetails,
  adaptQq101MayhemOverview,
  adaptQq101RankedDetails,
  adaptQq101RankedOverview,
  toQq101ClassicPosition,
  toQq101Position,
  toQq101Tier
} from '@shared/data-adapter/champion-data'
import type { LolpsHttpApiAxiosHelper } from '@shared/http-api-axios-helper/lolps'
import type { OpggHttpApiAxiosHelper } from '@shared/http-api-axios-helper/opgg'
import type { Qq101HttpApiAxiosHelper, Qq101RiftQuery } from '@shared/http-api-axios-helper/qq101'
import type { PositionType, RegionType, TierType } from '@shared/types/opgg'
import { formatError } from '@shared/utils/errors'
import type { AxiosInstance } from 'axios'
import dayjs from 'dayjs'

import type { AkariLogger } from '../logger-factory'
import type { ChampionDataLoadOptions, ChampionDataSourceLoader } from './context'
import { parseOpggMayhemAugments, parseOpggMayhemItems } from './opgg-web-data'

const UNIFIED_TO_OPGG_POSITION: Readonly<Record<ChampionDataPosition, PositionType>> = {
  all: 'all',
  top: 'top',
  jungle: 'jungle',
  middle: 'mid',
  bottom: 'adc',
  utility: 'support',
  none: 'none'
}

export class ChampionDataMainSourceLoader implements ChampionDataSourceLoader {
  constructor(
    private readonly _logger: AkariLogger,
    private readonly _opggApi: OpggHttpApiAxiosHelper,
    private readonly _qq101Api: Qq101HttpApiAxiosHelper,
    private readonly _lolpsApi: LolpsHttpApiAxiosHelper,
    private readonly _mayhemWeb: {
      http: AxiosInstance
      getSlug: (championId: number) => Promise<string | null>
    }
  ) {}

  private async _resolveOpggVersion(query: ChampionDataQuery, options: ChampionDataLoadOptions) {
    if (query.patch) return query.patch
    const response = await this._opggApi.getVersions(
      (query.region ?? 'global') as RegionType,
      query.mode,
      options
    )
    const version = response.data.data[0]
    if (!version) throw new Error(`OP.GG has no version for ${query.mode}`)
    return version
  }

  private async _resolveQq101RiftQuery(
    query: ChampionDataQuery,
    options: ChampionDataLoadOptions
  ): Promise<Qq101RiftQuery> {
    return {
      patch: query.patch ?? (await this._qq101Api.getLatestPatch(options)),
      tier: toQq101Tier(query.tier),
      position: toQq101Position(query.position)
    }
  }

  async loadPatches(
    source: ChampionDataSourceId,
    query: ChampionDataQuery,
    options: ChampionDataLoadOptions = {}
  ) {
    if (source === 'opgg') {
      if (query.mode === 'aram_mayhem') return []
      const response = await this._opggApi.getVersions(
        (query.region ?? 'global') as RegionType,
        query.mode,
        options
      )
      return response.data.data
    }

    if (source === 'lolps') {
      if (query.mode !== 'ranked') return []
      const response = await this._lolpsApi.getVersions(options)
      return response.data
    }

    if (query.mode === 'classic') return []
    const patches = await this._qq101Api.getPatches(options)
    return patches.map((patch) => patch.name)
  }

  async loadOverview(
    source: ChampionDataSourceId,
    query: ChampionDataQuery,
    options: ChampionDataLoadOptions = {}
  ) {
    if (source === 'opgg') {
      return this._loadOpggOverview(query, options)
    }
    if (source === 'lolps') {
      return this._loadLolpsOverview(query, options)
    }
    return this._loadQq101Overview(query, options)
  }

  async loadDetails(
    source: ChampionDataSourceId,
    query: ChampionDataQuery,
    championId: number,
    options: ChampionDataLoadOptions = {}
  ) {
    if (source === 'opgg') {
      return this._loadOpggDetails(query, championId, options)
    }
    if (source === 'lolps') {
      return this._loadLolpsDetails(query, championId, options)
    }
    return this._loadQq101Details(query, championId, options)
  }

  private async _loadOpggOverview(
    query: ChampionDataQuery,
    options: ChampionDataLoadOptions
  ): Promise<ChampionDataOverview> {
    if (query.mode === 'aram_mayhem') {
      const response = await this._opggApi.getAramMayhemTiers(options)
      return adaptOpggMayhemOverview(response.data, { dataDate: null })
    }

    const region = (query.region ?? 'global') as RegionType
    const version = await this._resolveOpggVersion(query, options)
    const response = await this._opggApi.getChampions(region, query.mode, {
      tier: query.tier as TierType | undefined,
      version,
      signal: options.signal
    })
    if (response.data.meta?.version !== version) {
      throw new Error('OP.GG overview patch does not match requested patch')
    }
    return adaptOpggChampionOverview(response.data, {
      mode: query.mode,
      position: query.position
    })
  }

  private async _loadOpggDetails(
    query: ChampionDataQuery,
    championId: number,
    options: ChampionDataLoadOptions
  ): Promise<ChampionDataDetails | null> {
    if (query.mode === 'aram_mayhem') {
      const slug = await this._mayhemWeb.getSlug(championId)
      const getPage = async (section: 'items' | 'augments') => {
        if (!slug || !/^[a-z0-9]+$/.test(slug)) throw new Error('Unknown Mayhem champion slug')
        const locale = section === 'augments' ? '/zh-cn' : ''
        const response = await this._mayhemWeb.http.get<string>(
          `https://op.gg${locale}/lol/modes/aram-mayhem/${slug}/${section}`,
          { signal: options.signal, responseType: 'text', headers: { 'Accept-Language': 'en-US' } }
        )
        return response.data
      }
      const [tiers, augments, itemsPage, augmentsPage] = await Promise.allSettled([
        this._opggApi.getAramMayhemTiers(options),
        this._opggApi.getAramMayhemChampionAugments(championId, options),
        getPage('items').then((page) => parseOpggMayhemItems(page, slug!)),
        getPage('augments').then((page) => parseOpggMayhemAugments(page, slug!))
      ])
      options.signal?.throwIfAborted()
      if (tiers.status === 'rejected') throw tiers.reason
      const tierItem = tiers.value.data.data.find((item) => item.champion_id === championId)
      if (!tierItem) return null
      for (const [label, result] of [
        ['Mayhem items', itemsPage],
        ['Mayhem augment resources', augmentsPage]
      ] as const)
        this._logPartialFailure(label, result)
      const details = adaptOpggMayhemDetails(
        tierItem,
        augments.status === 'fulfilled' ? augments.value.data : { data: [] },
        { dataDate: null }
      )
      if (augmentsPage.status === 'fulfilled') {
        details.sections.augments = augmentsPage.value.augments
        details.metadata.patch = augmentsPage.value.patch
      }
      if (
        itemsPage.status === 'fulfilled' &&
        (!details.metadata.patch || details.metadata.patch === itemsPage.value.patch)
      ) {
        details.sections.itemBuilds = itemsPage.value.itemBuilds
        details.metadata.patch = itemsPage.value.patch
      }
      if (!details.sections.augments?.length && !details.sections.itemBuilds?.length)
        throw new Error('Mayhem details unavailable')
      return details
    }

    const region = (query.region ?? 'global') as RegionType
    const version = await this._resolveOpggVersion(query, options)
    const position = UNIFIED_TO_OPGG_POSITION[query.position ?? 'none']
    const response = await this._opggApi.getChampion(region, query.mode, championId, position, {
      tier: query.tier as TierType | undefined,
      version,
      signal: options.signal
    })
    if (response.data.meta?.version !== version || response.data.data?.summary?.id !== championId) {
      throw new Error('OP.GG detail champion or patch does not match requested filters')
    }
    if (
      query.mode === 'ranked' &&
      position !== 'none' &&
      position !== 'all' &&
      !response.data.data.summary.positions?.some((item) => item.name.toLowerCase() === position)
    ) {
      throw new Error('OP.GG has no data for the requested position')
    }
    return adaptOpggChampionDetails(response.data, {
      mode: query.mode,
      position: query.position
    })
  }

  private async _loadLolpsOverview(
    query: ChampionDataQuery,
    options: ChampionDataLoadOptions
  ): Promise<ChampionDataOverview> {
    if (query.mode !== 'ranked') {
      throw new Error(`LOL.PS does not support mode ${query.mode}`)
    }
    const response = await this._lolpsApi.getChampions(
      { region: query.region, tier: query.tier, version: query.patch },
      options
    )
    return adaptLolpsChampionOverview(response, {
      mode: query.mode,
      position: query.position
    })
  }

  private async _loadLolpsDetails(
    query: ChampionDataQuery,
    championId: number,
    options: ChampionDataLoadOptions
  ): Promise<ChampionDataDetails | null> {
    if (query.mode !== 'ranked') return null
    const response = await this._lolpsApi.getChampion(
      championId,
      { region: query.region, position: query.position, tier: query.tier, version: query.patch },
      options
    )
    return adaptLolpsChampionDetails(response, {
      mode: query.mode,
      position: query.position
    })
  }

  private async _loadQq101Overview(
    query: ChampionDataQuery,
    options: ChampionDataLoadOptions
  ): Promise<ChampionDataOverview> {
    if (query.mode === 'classic') {
      const position = toQq101ClassicPosition(query.position)
      const result = await this._qq101Api.getClassicTierList(position, options)
      return adaptQq101ClassicOverview(result)
    }

    if (query.mode === 'ranked') {
      const riftQuery = await this._resolveQq101RiftQuery(query, options)
      let result = await this._qq101Api.getTierList(riftQuery, options)
      if (result.champions.length === 0 && !query.patch) {
        const patches = await this._qq101Api.getPatches(options)
        if (patches[1])
          result = await this._qq101Api.getTierList(
            { ...riftQuery, patch: patches[1].name },
            options
          )
      }
      return adaptQq101RankedOverview(result)
    }

    const date = dayjs().subtract(1, 'day').format('YYYYMMDD')
    const [champions, augments, synergies] = await Promise.allSettled([
      this._qq101Api.getMayhemChampions(date, options),
      this._qq101Api.getMayhemAugments(date, options),
      this._qq101Api.getMayhemPairSynergies(255, options)
    ])
    if (champions.status === 'rejected') throw champions.reason
    this._logPartialFailure('QQ101 Mayhem augments', augments)
    this._logPartialFailure('QQ101 Mayhem synergies', synergies)
    const input: Qq101MayhemInput = {
      date: champions.value.date,
      champions: champions.value.champions,
      ...(augments.status === 'fulfilled' ? { augments: augments.value.augments } : {}),
      ...(synergies.status === 'fulfilled' ? { synergies: synergies.value.synergies } : {})
    }
    return adaptQq101MayhemOverview(input)
  }

  private async _loadQq101Details(
    query: ChampionDataQuery,
    championId: number,
    options: ChampionDataLoadOptions
  ): Promise<ChampionDataDetails | null> {
    if (query.mode === 'classic') return null

    if (query.mode === 'aram_mayhem') {
      const date = dayjs().subtract(1, 'day').format('YYYYMMDD')
      const [champions, augments] = await Promise.allSettled([
        this._qq101Api.getMayhemChampions(date, options),
        this._qq101Api.getMayhemAugments(date, options)
      ])
      if (champions.status === 'rejected') throw champions.reason
      this._logPartialFailure('QQ101 Mayhem augments', augments)
      return adaptQq101MayhemDetails(
        {
          date: champions.value.date,
          champions: champions.value.champions,
          ...(augments.status === 'fulfilled' ? { augments: augments.value.augments } : {})
        },
        championId
      )
    }

    const riftQuery = await this._resolveQq101RiftQuery(query, options)
    const overview = await this._qq101Api.getTierList(riftQuery, options)
    const champion = overview.champions.find((item) => item.championId === championId)
    if (!champion) return null

    const results = await Promise.allSettled([
      this._qq101Api.getMatchups(riftQuery, championId, options),
      this._qq101Api.getSynergies(riftQuery, championId, options),
      this._qq101Api.getSummonerSpells(riftQuery, championId, options),
      this._qq101Api.getSkillOrder(riftQuery, championId, options),
      this._qq101Api.getBuild(riftQuery, championId, options),
      this._qq101Api.getRunes(riftQuery, championId, options),
      this._qq101Api.getPositions(riftQuery, championId, options),
      this._qq101Api.getTrend(riftQuery, championId, options),
      this._qq101Api.getTierStats(riftQuery, championId, options),
      this._qq101Api.getDurations(riftQuery, championId, options)
    ] as const)
    const labels = [
      'matchups',
      'synergies',
      'summoner spells',
      'skill order',
      'build',
      'runes',
      'positions',
      'trend',
      'tier stats',
      'durations'
    ]
    results.forEach((result, index) => this._logPartialFailure(`QQ101 ${labels[index]}`, result))
    const value = <T>(index: number) =>
      results[index].status === 'fulfilled' ? (results[index].value as T) : undefined
    const matchups = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getMatchups']>>>(0)
    const synergies = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getSynergies']>>>(1)
    const spells = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getSummonerSpells']>>>(2)
    const skills = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getSkillOrder']>>>(3)
    const build = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getBuild']>>>(4)
    const runes = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getRunes']>>>(5)
    const positions = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getPositions']>>>(6)
    const trend = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getTrend']>>>(7)
    const tiers = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getTierStats']>>>(8)
    const durations = value<Awaited<ReturnType<Qq101HttpApiAxiosHelper['getDurations']>>>(9)
    const input: Qq101RankedDetailsInput = {
      date: overview.date,
      patch: overview.patch,
      champion,
      ...(matchups
        ? { matchups: { favorable: matchups.favorable, unfavorable: matchups.unfavorable } }
        : {}),
      ...(synergies ? { synergies: synergies.synergies } : {}),
      ...(spells ? { summonerSpells: spells.recommendations } : {}),
      ...(skills ? { abilityBuild: skills } : {}),
      ...(build ? { itemBuild: build } : {}),
      ...(runes ? { runes } : {}),
      ...(positions ? { positions: positions.positions } : {}),
      ...(trend ? { trends: trend.points } : {}),
      ...(tiers ? { tiers: tiers.tiers } : {}),
      ...(durations ? { durations: durations.durations } : {})
    }
    return adaptQq101RankedDetails(input)
  }

  private _logPartialFailure(label: string, result: PromiseSettledResult<unknown>) {
    if (result.status === 'rejected') {
      this._logger.warn(`${label} failed; continuing with partial data`, formatError(result.reason))
    }
  }
}
