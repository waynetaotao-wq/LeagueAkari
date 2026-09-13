import type { BzMatchupRow } from '@shared/types/counter-intel'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'

import { canonicalName } from './table'
import bundled from './verified-snapshot.json'

// Store only parsed public advice. Resource URLs, IPC state and catalog validation are not persisted.
const imageSchema = z.object({
  status: z.enum(['ready', 'partial', 'unavailable']),
  spellIds: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  starterItemId: z.number().int().positive().optional(),
  fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  issues: z
    .array(
      z.object({
        code: z.enum([
          'source-unavailable',
          'unknown-image',
          'ambiguous-position',
          'overlapping-images',
          'missing-spells',
          'missing-starter',
          'ambiguous-spells',
          'ambiguous-starter',
          'catalog-unavailable',
          'unavailable-in-patch'
        ]),
        field: z.enum(['spells', 'starter', 'both'])
      })
    )
    .max(30)
})
const snapshotSchema = z.object({
  schema: z.literal(1),
  sheetId: z.literal('1FInDZ2JhIyto2y-FnCcgCVlAYcjRaF7egcpsV41Spic'),
  fetchedAt: z.number().int().positive(),
  rows: z
    .array(
      z.object({
        champion: z.string().min(1).max(100),
        rune: z.string().max(1000),
        difficulty: z.string().max(1000),
        coreBuild: z.string().max(3000),
        summary: z.string().max(20000),
        keystonePerkId: z.number().int().positive().nullable(),
        sourceFormat: z.literal('xlsx'),
        sourceSheet: z.string().max(100),
        sourceRow: z.number().int().min(1).max(2000),
        imageLoadout: imageSchema
      })
    )
    .min(1)
    .max(1000)
})
export type BzWorkbookSnapshot = z.infer<typeof snapshotSchema>
const MAX_SNAPSHOT_BYTES = 1024 * 1024

/** Stable Riot champion identities keep the known guide available when OP.GG is unreachable. */
export function getBzKnownChampionSlug(championId: number): string | null {
  return (bundled.championSlugs as Record<string, string>)[String(championId)] ?? null
}

export function parseBzSnapshot(value: unknown): BzWorkbookSnapshot {
  const result = snapshotSchema.parse(value)
  if (
    result.fetchedAt > Date.now() + 5 * 60_000 ||
    new Set(result.rows.map((row) => canonicalName(row.champion))).size !== result.rows.length
  ) {
    throw new Error('Invalid Bz snapshot timestamp or duplicate champions')
  }
  return result
}

export function createBzSnapshot(rows: BzMatchupRow[], fetchedAt: number): BzWorkbookSnapshot {
  return parseBzSnapshot({ schema: 1, sheetId: bundled.sheetId, fetchedAt, rows })
}

export async function readBzSnapshot(file?: string): Promise<BzWorkbookSnapshot> {
  // A machine clock set before the release date must not hide the bundled reading reference.
  const fallback = snapshotSchema.parse(bundled)
  if (!file) return fallback
  try {
    if ((await stat(file)).size > MAX_SNAPSHOT_BYTES) return fallback
    const cached = parseBzSnapshot(JSON.parse(await readFile(file, 'utf8')))
    return cached.fetchedAt >= fallback.fetchedAt ? cached : fallback
  } catch {
    return fallback
  }
}

export async function writeBzSnapshot(file: string, snapshot: BzWorkbookSnapshot) {
  const json = JSON.stringify(parseBzSnapshot(snapshot))
  if (Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES)
    throw new Error('Bz snapshot exceeds size limit')
  await mkdir(dirname(file), { recursive: true })
  await writeFile(`${file}.tmp`, json, 'utf8')
  await rename(`${file}.tmp`, file)
}
