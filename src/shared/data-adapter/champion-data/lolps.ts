import { supportsChampionDataFeature } from './capabilities'
import type {
  ChampionDataDetails,
  ChampionDataMetadata,
  ChampionDataMode,
  ChampionDataOverview,
  ChampionDataPosition,
  ChampionOverviewItem,
  ChampionPerformance,
  ChampionRecommendationPerformance
} from './types'

// ==================================================================
// LOL.PS 数据源载荷形状（由 LolpsHttpApiAxiosHelper 构造）
// 字段命名沿用 OP.GG 线格式，便于与 opgg 翻译器保持同构。
// ==================================================================

export type LolpsPositionName = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'

export interface LolpsTierData {
  tier: number
  rank: number
  rank_prev: number
}

export interface LolpsAverageStats {
  play: number
  win: number | null
  win_rate: number | null
  pick_rate: number | null
  ban_rate: number | null
  kda: number | null
  tier: number | null
  rank: number | null
  tier_data: LolpsTierData
}

export interface LolpsPositionStats {
  play: number
  win: number | null
  win_rate: number | null
  pick_rate: number | null
  ban_rate: number | null
  kda: number | null
  role_rate: number | null
  tier_data: LolpsTierData
}

export interface LolpsCounter {
  champion_id: number
  play?: number
  win?: number
  pick_rate?: number
}

export interface LolpsChampionPosition {
  name: LolpsPositionName | (string & {})
  stats: LolpsPositionStats
  counters: LolpsCounter[]
}

export interface LolpsChampionItem {
  id: number
  average_stats: LolpsAverageStats | null
  positions: LolpsChampionPosition[]
}

export interface LolpsPickItem {
  ids: number[]
  play?: number
  win?: number
  pick_rate?: number
}

export interface LolpsRuneBuild {
  primary_page_id: number | null
  secondary_page_id: number | null
  primary_rune_ids: number[]
  secondary_rune_ids: number[]
  stat_mod_ids: number[]
  play?: number
  win?: number
  pick_rate?: number
}

export interface LolpsSkillBuild {
  order: string[]
  play?: number
  win?: number
  pick_rate?: number
}

export interface LolpsSkillMastery {
  ids: string[]
  play?: number
  win?: number
  pick_rate?: number
  builds: LolpsSkillBuild[]
}

export interface LolpsChampionsPayload {
  data: LolpsChampionItem[]
  meta: { version: string; cached_at: string }
}

export interface LolpsChampionBuildPayload {
  data: {
    summary: LolpsChampionItem
    summoner_spells: LolpsPickItem[]
    runes: LolpsRuneBuild[]
    skill_masteries: LolpsSkillMastery[]
    starter_items: LolpsPickItem[]
    boots: LolpsPickItem[]
    core_items: LolpsPickItem[]
    last_items: LolpsPickItem[]
    counters: LolpsCounter[]
  }
  meta: { version: string; cached_at: string }
}

export interface LolpsAdapterOptions {
  mode: ChampionDataMode
  position?: ChampionDataPosition
}

// ==================================================================
// 统一翻译器（与 opgg.ts 同构，source 与特性门控换成 'lolps'）
// ==================================================================

const LOLPS_POSITION_TO_UNIFIED: Readonly<Record<string, ChampionDataPosition>> = {
  TOP: 'top',
  JUNGLE: 'jungle',
  MID: 'middle',
  ADC: 'bottom',
  SUPPORT: 'utility'
}

function ratio(numerator: number | null | undefined, denominator: number | null | undefined) {
  return numerator === undefined ||
    numerator === null ||
    denominator === undefined ||
    denominator === null ||
    denominator === 0
    ? null
    : numerator / denominator
}

function isoString(value: string | undefined) {
  if (value === undefined) return null
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? null : date.toISOString()
}

function recommendationPerformance(item: {
  play?: number
  win?: number
  pick_rate?: number
}): ChampionRecommendationPerformance {
  return {
    games: item.play ?? null,
    wins: item.win ?? null,
    winRate: ratio(item.win, item.play),
    pickRate: item.pick_rate ?? null,
    rank: null,
    averagePlacement: null,
    firstPlaceRate: null
  }
}

function championPerformance(stats: LolpsAverageStats | null): ChampionPerformance {
  if (!stats) {
    return {
      games: null,
      wins: null,
      winRate: null,
      pickRate: null,
      banRate: null,
      kda: null,
      rank: null,
      rankChange: null,
      strengthTier: null,
      averagePlacement: null,
      firstPlaceRate: null
    }
  }

  return {
    games: stats.play ?? null,
    wins: stats.win ?? null,
    winRate: stats.win_rate ?? ratio(stats.win, stats.play),
    pickRate: stats.pick_rate ?? null,
    banRate: stats.ban_rate ?? null,
    kda: stats.kda ?? null,
    rank: stats.rank ?? stats.tier_data.rank,
    rankChange: stats.tier_data.rank_prev - stats.tier_data.rank,
    strengthTier: stats.tier ?? stats.tier_data.tier,
    averagePlacement: null,
    firstPlaceRate: null
  }
}

function positionPerformance(position: LolpsChampionPosition): ChampionPerformance {
  const stats = position.stats
  return {
    games: stats.play ?? null,
    wins: stats.win ?? null,
    winRate: stats.win_rate ?? null,
    pickRate: stats.pick_rate ?? null,
    banRate: stats.ban_rate ?? null,
    kda: stats.kda ?? null,
    rank: stats.tier_data.rank,
    rankChange: stats.tier_data.rank_prev - stats.tier_data.rank,
    strengthTier: stats.tier_data.tier,
    averagePlacement: null,
    firstPlaceRate: null
  }
}

function findPosition(
  positions: LolpsChampionPosition[] | null | undefined,
  position: ChampionDataPosition | undefined
) {
  if (!position || position === 'all' || position === 'none') return null
  return positions?.find((item) => LOLPS_POSITION_TO_UNIFIED[item.name] === position) ?? null
}

function overviewItem(
  item: LolpsChampionItem,
  requestedPosition?: ChampionDataPosition
): ChampionOverviewItem {
  const selectedPosition = findPosition(item.positions, requestedPosition)
  return {
    championId: item.id,
    position: selectedPosition
      ? (LOLPS_POSITION_TO_UNIFIED[selectedPosition.name] ?? 'all')
      : (requestedPosition ?? 'all'),
    performance: selectedPosition
      ? positionPerformance(selectedPosition)
      : championPerformance(item.average_stats),
    counterChampionIds: selectedPosition?.counters.map((counter) => counter.champion_id) ?? []
  }
}

function metadata(
  version: string | undefined,
  cachedAt: string | undefined,
  options: LolpsAdapterOptions
): ChampionDataMetadata {
  return {
    source: 'lolps',
    mode: options.mode,
    patch: version || null,
    dataDate: null,
    updatedAt: isoString(cachedAt)
  }
}

function buildOptions(items: LolpsPickItem[]) {
  return items.map((item) => ({
    itemIds: [...item.ids],
    performance: recommendationPerformance(item)
  }))
}

function matchup(counter: LolpsCounter) {
  return {
    championId: counter.champion_id,
    relationship: 'unknown' as const,
    performance: recommendationPerformance(counter)
  }
}

export function adaptLolpsChampionOverview(
  response: LolpsChampionsPayload,
  options: LolpsAdapterOptions
): ChampionDataOverview {
  return {
    metadata: metadata(response.meta.version, response.meta.cached_at, options),
    sections: {
      champions: response.data.map((item) => overviewItem(item, options.position))
    }
  }
}

export function adaptLolpsChampionDetails(
  response: LolpsChampionBuildPayload,
  options: LolpsAdapterOptions
): ChampionDataDetails {
  const data = response.data
  const selectedPosition = findPosition(data.summary.positions, options.position)
  const counters = data.counters.length > 0 ? data.counters : (selectedPosition?.counters ?? [])
  const supports = (feature: Parameters<typeof supportsChampionDataFeature>[2]) =>
    supportsChampionDataFeature('lolps', options.mode, feature)

  return {
    metadata: metadata(response.meta.version, response.meta.cached_at, options),
    championId: data.summary.id,
    summary: overviewItem(data.summary, options.position),
    sections: {
      ...(supports('matchups') ? { matchups: counters.map(matchup) } : {}),
      ...(supports('summoner-spells')
        ? {
            summonerSpells: data.summoner_spells.map((item) => ({
              spellIds: [...item.ids],
              performance: recommendationPerformance(item)
            }))
          }
        : {}),
      ...(supports('ability-builds')
        ? {
            abilityBuilds: data.skill_masteries.flatMap((mastery) => {
              if (mastery.builds.length === 0) {
                return [
                  {
                    abilityPriority: [...mastery.ids],
                    levelOrder: [],
                    performance: recommendationPerformance(mastery)
                  }
                ]
              }
              return mastery.builds.map((build) => ({
                abilityPriority: [...mastery.ids],
                levelOrder: [...(build.order ?? [])],
                performance: recommendationPerformance(build)
              }))
            })
          }
        : {}),
      ...(supports('item-builds')
        ? {
            itemBuilds: [
              { slot: 'starting' as const, options: buildOptions(data.starter_items) },
              { slot: 'boots' as const, options: buildOptions(data.boots) },
              { slot: 'core' as const, options: buildOptions(data.core_items) },
              { slot: 'last' as const, options: buildOptions(data.last_items) }
            ]
          }
        : {}),
      ...(supports('rune-pages')
        ? {
            runePages: data.runes.map((item) => ({
              primaryStyleId: item.primary_page_id,
              secondaryStyleId: item.secondary_page_id,
              primaryRuneIds: [...item.primary_rune_ids],
              secondaryRuneIds: [...item.secondary_rune_ids],
              statShardIds: [...item.stat_mod_ids],
              performance: recommendationPerformance(item)
            }))
          }
        : {}),
      ...(supports('position-stats')
        ? {
            positions: data.summary.positions.map((position) => ({
              position: LOLPS_POSITION_TO_UNIFIED[position.name] ?? ('all' as const),
              share: position.stats.role_rate,
              performance: positionPerformance(position)
            }))
          }
        : {})
    }
  }
}
