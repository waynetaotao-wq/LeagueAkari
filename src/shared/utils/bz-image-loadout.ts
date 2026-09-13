import type { BzMatchupRow } from '@shared/types/counter-intel'

export interface BzRecommendedLoadout {
  spellIds?: readonly [number, number]
  starterItemId?: number
}

/** Both display and build promotion use the same freshness and per-field conflict rules. */
export function resolveBzImageLoadout(
  row: Pick<BzMatchupRow, 'stale' | 'itemCatalogStale' | 'imageLoadout'>,
  historical?: Readonly<BzRecommendedLoadout> | null
): BzRecommendedLoadout | null {
  if (row.stale || row.itemCatalogStale) return null
  const images = row.imageLoadout
  if (!images || images.status === 'unavailable') return historical ?? null
  // A partially recognized online row must never be completed using an older manual snapshot.
  if (!images.catalogVersion) return null
  return {
    spellIds: images.issues.some((issue) => issue.field === 'spells' || issue.field === 'both')
      ? undefined
      : images.spellIds,
    starterItemId: images.issues.some(
      (issue) => issue.field === 'starter' || issue.field === 'both'
    )
      ? undefined
      : images.starterItemId
  }
}
