import {
  type BzExtras,
  getBzExtras
} from '@renderer-shared/components/ongoing-game-panel/widgets/player-info-card/bz-summary-zh'

export type BzOverlaySection = 'summoner_spells' | 'starter_items' | 'core_items' | 'runes'

export type BzRuneFilterStatus =
  'not-requested' | 'missing-runes' | 'no-match' | 'already-matched' | 'filtered'

export interface BzOverlayRecommendation {
  champion?: string
  coreItemIds?: readonly number[]
  coreItemBuilds?: readonly (readonly number[])[]
  keystonePerkId?: number | null
}

export interface MergeBzIntoOverlayResult {
  overlay: Record<string, unknown> | null
  /** Bz recommendations that changed the overlay. */
  sections: BzOverlaySection[]
  runeFilterStatus: BzRuneFilterStatus
}

export interface BzRecommendationRow {
  ids: number[]
  play: 0
  win: 0
  pick_rate: 0
  is_bz_recommendation: true
}

type OverlayRow = Record<string, unknown>

const COMPLETE_MATCHUP_SECTIONS = [
  'summoner_spells',
  'runes',
  'skill_masteries',
  'starter_items',
  'boots',
  'core_items',
  'last_items',
  'prism_items'
] as const

function emptyCompleteOverlay(): Record<string, unknown> {
  return Object.fromEntries(COMPLETE_MATCHUP_SECTIONS.map((section) => [section, []]))
}

function isRecord(value: unknown): value is OverlayRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneRow(row: unknown): unknown {
  if (!isRecord(row)) return row
  return {
    ...row,
    ...(Array.isArray(row.ids) ? { ids: [...row.ids] } : {})
  }
}

function rowIds(row: unknown): number[] | null {
  if (!isRecord(row) || !Array.isArray(row.ids)) return null
  if (!row.ids.every((id) => typeof id === 'number' && Number.isFinite(id))) return null
  return row.ids
}

function validIds(value: unknown, minimumLength: number): number[] | null {
  if (!Array.isArray(value) || value.length < minimumLength) return null
  if (!value.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)) {
    return null
  }
  return [...value]
}

function sameIds(left: readonly number[], right: readonly number[]) {
  return left.length === right.length && left.every((id, index) => id === right[index])
}

function sameUnorderedIds(left: readonly number[], right: readonly number[]) {
  if (left.length !== right.length) return false
  const remaining = [...right]
  for (const id of left) {
    const index = remaining.indexOf(id)
    if (index < 0) return false
    remaining.splice(index, 1)
  }
  return true
}

function uniqueBuilds(builds: readonly (readonly number[])[]) {
  const result: number[][] = []
  for (const build of builds) {
    if (!result.some((existing) => sameIds(existing, build))) result.push([...build])
  }
  return result
}

function coreItemBuilds(bz: BzOverlayRecommendation): number[][] {
  const builds: number[][] = []
  if (Array.isArray(bz.coreItemBuilds)) {
    for (const build of bz.coreItemBuilds) {
      const ids = validIds(build, 2)
      if (ids) builds.push(ids)
    }
  }
  const legacyBuild = validIds(bz.coreItemIds, 2)
  if (legacyBuild) builds.push(legacyBuild)
  return uniqueBuilds(builds)
}

function recommendationRow(ids: readonly number[]): BzRecommendationRow {
  return {
    ids: [...ids],
    play: 0,
    win: 0,
    pick_rate: 0,
    is_bz_recommendation: true
  }
}

function promoteRows(
  value: unknown,
  recommendations: readonly (readonly number[])[],
  equals: (left: readonly number[], right: readonly number[]) => boolean
) {
  const existing = Array.isArray(value) ? value : []
  const remaining = existing.map((row, sourceIndex) => ({
    row: cloneRow(row),
    sourceIndex
  }))
  const promoted: Array<{ row: unknown; sourceIndex: number | null }> = []

  for (const ids of recommendations) {
    const matchingIndexes: number[] = []
    for (let index = 0; index < remaining.length; index++) {
      const existingIds = rowIds(remaining[index].row)
      if (existingIds && equals(existingIds, ids)) matchingIndexes.push(index)
    }

    if (matchingIndexes.length === 0) {
      promoted.push({ row: recommendationRow(ids), sourceIndex: null })
      continue
    }

    const firstMatch = remaining[matchingIndexes[0]]
    promoted.push(firstMatch)
    for (let index = matchingIndexes.length - 1; index >= 0; index--) {
      remaining.splice(matchingIndexes[index], 1)
    }
  }

  const ordered = [...promoted, ...remaining]
  const changed =
    ordered.length !== existing.length ||
    ordered.some((entry, index) => entry.sourceIndex !== index)

  return {
    rows: ordered.map((entry) => entry.row),
    changed
  }
}

function resolveExtras(
  bz: BzOverlayRecommendation,
  extras: Readonly<BzExtras> | null | undefined
): Readonly<BzExtras> | null {
  if (extras !== undefined) return extras
  return bz.champion ? getBzExtras(bz.champion) : null
}

/**
 * Adds Bz recommendations to an OP.GG-shaped matchup overlay without mutating either input.
 * Existing rows retain their real statistics; only synthesized rows receive the Bz marker.
 */
export function mergeBzIntoOverlay(
  overlay: Readonly<Record<string, unknown>> | null,
  bz: Readonly<BzOverlayRecommendation> | null | undefined,
  extras?: Readonly<BzExtras> | null
): MergeBzIntoOverlayResult {
  // BZ-only 时也先写齐七个空键；否则 OpggView 的浅合并会把缺键补成通用数据。
  const base: Record<string, unknown> = overlay ? { ...overlay } : bz ? emptyCompleteOverlay() : {}
  const sections: BzOverlaySection[] = []
  let runeFilterStatus: BzRuneFilterStatus = 'not-requested'

  if (!bz) {
    return {
      overlay: overlay ? base : null,
      sections,
      runeFilterStatus
    }
  }

  const resolvedExtras = resolveExtras(bz, extras)
  if (resolvedExtras) {
    const spellIds = validIds(resolvedExtras.spellIds, 2)
    if (spellIds) {
      const spells = promoteRows(base.summoner_spells, [spellIds], sameUnorderedIds)
      base.summoner_spells = spells.rows
      if (spells.changed) sections.push('summoner_spells')
    }

    const starterItemIds = validIds([resolvedExtras.starterItemId], 1)
    if (starterItemIds) {
      const starterItems = promoteRows(base.starter_items, [starterItemIds], sameIds)
      base.starter_items = starterItems.rows
      if (starterItems.changed) sections.push('starter_items')
    }
  }

  const builds = coreItemBuilds(bz)
  if (builds.length > 0) {
    const coreItems = promoteRows(base.core_items, builds, sameIds)
    base.core_items = coreItems.rows
    if (coreItems.changed) sections.push('core_items')
  }

  const keystone = bz.keystonePerkId
  if (typeof keystone === 'number' && Number.isInteger(keystone) && keystone > 0) {
    const runes = Array.isArray(base.runes) ? base.runes : null
    if (!runes?.length) {
      runeFilterStatus = 'missing-runes'
    } else {
      const matchingRunes = runes.filter((page) => {
        if (!isRecord(page) || !Array.isArray(page.primary_rune_ids)) return false
        return page.primary_rune_ids[0] === keystone
      })

      if (matchingRunes.length === 0) {
        runeFilterStatus = 'no-match'
      } else if (matchingRunes.length === runes.length) {
        runeFilterStatus = 'already-matched'
      } else {
        base.runes = matchingRunes.map(cloneRow)
        runeFilterStatus = 'filtered'
        sections.push('runes')
      }
    }
  }

  return {
    overlay: overlay || sections.length > 0 ? base : null,
    sections,
    runeFilterStatus
  }
}

export function isBzRecommendation(row: unknown): row is BzRecommendationRow {
  return isRecord(row) && row.is_bz_recommendation === true
}
