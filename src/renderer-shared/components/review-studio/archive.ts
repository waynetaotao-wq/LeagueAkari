import {
  REVIEW_STORAGE_NAMESPACE,
  type ReviewArchiveScope,
  type ReviewStorageAdapter,
  reviewScopeKey
} from './notes'
import type { ReviewEvent, ReviewMatch, ReviewPosition, ReviewSnapshot } from './types'

export type { ReviewArchiveScope } from './notes'

export const MAX_REVIEW_ARCHIVE_GAMES = 200
export const REVIEW_ARCHIVE_WARNING = '历史存档，不含地图回放，请重新拉取对局'

export interface ReviewArchiveRecord {
  match: ReviewMatch
  savedAt: number
}

const queues = new WeakMap<ReviewStorageAdapter, Map<string, Promise<void>>>()
const positions: ReviewPosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN']

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function nonnegative(value: unknown): value is number {
  return finite(value) && value >= 0
}

function integer(value: unknown): value is number {
  return nonnegative(value) && Number.isInteger(value)
}

function positiveInteger(value: unknown): value is number {
  return integer(value) && value > 0
}

function nullableNumber(value: unknown): value is number | null {
  return value === null || finite(value)
}

function nullableId(value: unknown): value is number | null {
  return value === null || positiveInteger(value)
}

function optionalText(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= 100)
}

function parseSnapshot(value: unknown): ReviewSnapshot | null {
  const snapshot = object(value)
  if (
    !snapshot ||
    ![10, 15, 20].includes(snapshot.minute as number) ||
    !(snapshot.timestamp === null || nonnegative(snapshot.timestamp)) ||
    !nullableNumber(snapshot.personalGoldDiff) ||
    !nullableNumber(snapshot.personalCsDiff) ||
    !nullableNumber(snapshot.teamGoldDiff) ||
    (snapshot.timestamp === null &&
      [snapshot.personalGoldDiff, snapshot.personalCsDiff, snapshot.teamGoldDiff].some(
        (value) => value !== null
      )) ||
    (finite(snapshot.timestamp) &&
      Math.abs(snapshot.timestamp - (snapshot.minute as number) * 60000) > 10000)
  ) {
    return null
  }
  return {
    minute: snapshot.minute as 10 | 15 | 20,
    timestamp: snapshot.timestamp,
    personalGoldDiff: snapshot.personalGoldDiff,
    personalCsDiff: snapshot.personalCsDiff,
    teamGoldDiff: snapshot.teamGoldDiff
  }
}

function parseEvent(value: unknown): ReviewEvent | null {
  const event = object(value)
  if (
    !event ||
    typeof event.id !== 'string' ||
    event.id.length > 200 ||
    !nonnegative(event.timestamp) ||
    !['kill', 'building', 'monster'].includes(event.type as string) ||
    !nullableId(event.killerId) ||
    !nullableId(event.victimId) ||
    !Array.isArray(event.assistingParticipantIds) ||
    event.assistingParticipantIds.length > 10 ||
    !event.assistingParticipantIds.every(positiveInteger) ||
    ![100, 200, null].includes(event.teamId as number | null) ||
    !(event.shutdownBounty === null || nonnegative(event.shutdownBounty)) ||
    !optionalText(event.buildingType) ||
    !optionalText(event.laneType) ||
    !optionalText(event.monsterType) ||
    !optionalText(event.monsterSubType)
  ) {
    return null
  }
  // Coordinates are intentionally omitted: archives retain evidence for aggregate conversion only.
  return {
    id: event.id,
    timestamp: event.timestamp,
    type: event.type as ReviewEvent['type'],
    killerId: event.killerId,
    victimId: event.victimId,
    assistingParticipantIds: [...event.assistingParticipantIds],
    teamId: event.teamId as ReviewEvent['teamId'],
    position: null,
    shutdownBounty: event.shutdownBounty,
    buildingType: event.buildingType,
    laneType: event.laneType,
    monsterType: event.monsterType,
    monsterSubType: event.monsterSubType
  }
}

/** Validates persisted data and rebuilds it, so accidentally stored frame tracks never survive. */
function compactMatch(value: unknown): ReviewMatch | null {
  const match = object(value)
  const meta = object(match?.meta)
  const quality = object(match?.quality)
  if (
    !match ||
    !meta ||
    !quality ||
    !positiveInteger(meta.gameId) ||
    typeof meta.sgpServerId !== 'string' ||
    !meta.sgpServerId ||
    typeof meta.puuid !== 'string' ||
    !meta.puuid ||
    !nonnegative(meta.gameCreation) ||
    !nonnegative(meta.gameDuration) ||
    !integer(meta.queueId) ||
    typeof meta.patch !== 'string' ||
    meta.patch.length > 100 ||
    !positiveInteger(meta.championId) ||
    !positions.includes(meta.position as ReviewPosition) ||
    !positiveInteger(meta.participantId) ||
    ![100, 200].includes(meta.teamId as number) ||
    !nullableId(meta.opponentId) ||
    !nullableId(meta.opponentChampionId) ||
    typeof meta.win !== 'boolean' ||
    !Array.isArray(match.snapshots) ||
    match.snapshots.length !== 3 ||
    !Array.isArray(match.events) ||
    match.events.length > 500 ||
    !integer(quality.expectedFrames) ||
    !integer(quality.missingFrames) ||
    !nonnegative(quality.timelineCoverage) ||
    quality.timelineCoverage > 1 ||
    !integer(quality.validGoldSnapshots) ||
    !integer(quality.validCsSnapshots) ||
    !integer(quality.validTeamSnapshots) ||
    !['complete', 'partial'].includes(quality.eventCoverage as string) ||
    !Array.isArray(quality.warnings) ||
    quality.warnings.length > 100 ||
    !quality.warnings.every((warning) => typeof warning === 'string' && warning.length <= 1000)
  ) {
    return null
  }
  const snapshots = match.snapshots.map(parseSnapshot)
  if (snapshots.some((snapshot) => snapshot === null)) return null
  if (new Set(snapshots.map((snapshot) => snapshot!.minute)).size !== 3) return null
  const events = match.events.map(parseEvent)
  if (events.some((event) => event === null)) return null
  const retainedEvents = (events as ReviewEvent[]).filter(
    (event) =>
      (event.type === 'kill' && event.victimId === meta.participantId) ||
      (event.type !== 'kill' && event.teamId !== null && event.teamId !== meta.teamId)
  )
  return {
    meta: {
      gameId: meta.gameId,
      sgpServerId: meta.sgpServerId,
      puuid: meta.puuid,
      gameCreation: meta.gameCreation,
      gameDuration: meta.gameDuration,
      queueId: meta.queueId,
      patch: meta.patch,
      championId: meta.championId,
      position: meta.position as ReviewPosition,
      participantId: meta.participantId,
      teamId: meta.teamId as 100 | 200,
      opponentId: meta.opponentId,
      opponentChampionId: meta.opponentChampionId,
      win: meta.win
    },
    participants: [],
    frames: [],
    events: retainedEvents,
    moments: [],
    snapshots: snapshots as ReviewSnapshot[],
    quality: {
      expectedFrames: quality.expectedFrames,
      missingFrames: quality.missingFrames,
      timelineCoverage: quality.timelineCoverage,
      validGoldSnapshots: quality.validGoldSnapshots,
      validCsSnapshots: quality.validCsSnapshots,
      validTeamSnapshots: quality.validTeamSnapshots,
      eventCoverage: quality.eventCoverage as 'complete' | 'partial',
      warnings: [...new Set([...quality.warnings, REVIEW_ARCHIVE_WARNING])]
    }
  }
}

export function toReviewArchiveRecord(match: ReviewMatch, now = Date.now()): ReviewArchiveRecord {
  const compact = compactMatch(match)
  if (!compact || !nonnegative(now)) throw new Error('对局存档格式无效')
  return { match: compact, savedAt: now }
}

export function mergeReviewArchive(
  existing: ReviewArchiveRecord[],
  incoming: ReviewArchiveRecord[]
): ReviewArchiveRecord[] {
  const records = new Map<string, ReviewArchiveRecord>()
  for (const record of [...existing, ...incoming]) {
    const key = JSON.stringify([record.match.meta.sgpServerId, record.match.meta.gameId])
    const previous = records.get(key)
    if (!previous || previous.savedAt <= record.savedAt) records.set(key, record)
  }
  return [...records.values()]
    .sort((a, b) => b.match.meta.gameCreation - a.match.meta.gameCreation || b.savedAt - a.savedAt)
    .slice(0, MAX_REVIEW_ARCHIVE_GAMES)
}

function matchesScope(match: ReviewMatch, scope: ReviewArchiveScope): boolean {
  return match.meta.puuid === scope.targetPuuid && match.meta.sgpServerId === scope.targetServerId
}

export async function readReviewArchive(
  storage: ReviewStorageAdapter,
  scope: ReviewArchiveScope
): Promise<ReviewArchiveRecord[]> {
  const value = object(
    await storage.get(REVIEW_STORAGE_NAMESPACE, `archive:${reviewScopeKey(scope)}`)
  )
  if (
    !value ||
    value.version !== 1 ||
    !Array.isArray(value.records) ||
    value.records.length > 1000
  ) {
    return []
  }
  const records: ReviewArchiveRecord[] = []
  for (const valueRecord of value.records) {
    const record = object(valueRecord)
    if (!record || !nonnegative(record.savedAt)) continue
    const match = compactMatch(record.match)
    if (match && matchesScope(match, scope)) records.push({ match, savedAt: record.savedAt })
  }
  return mergeReviewArchive([], records)
}

/** Serializes each local key's read/merge/write cycle to prevent concurrent batches losing games. */
export function writeReviewArchive(
  storage: ReviewStorageAdapter,
  scope: ReviewArchiveScope,
  matches: ReviewMatch[]
): Promise<ReviewArchiveRecord[]> {
  const capturedScope = { ...scope }
  const key = `archive:${reviewScopeKey(capturedScope)}`
  const incoming = matches
    .filter((match) => matchesScope(match, capturedScope))
    .map((match) => toReviewArchiveRecord(match))
  let storageQueues = queues.get(storage)
  if (!storageQueues) {
    storageQueues = new Map()
    queues.set(storage, storageQueues)
  }
  const previous = storageQueues.get(key) ?? Promise.resolve()
  const result = previous.then(async () => {
    const existing = await readReviewArchive(storage, capturedScope)
    const records = mergeReviewArchive(existing, incoming)
    await storage.set(REVIEW_STORAGE_NAMESPACE, key, { version: 1, records })
    return records
  })
  // Keep the queue usable after an error; callers still receive the original rejection.
  const tail = result.then(
    () => undefined,
    () => undefined
  )
  storageQueues.set(key, tail)
  void tail.then(() => {
    if (storageQueues.get(key) === tail) storageQueues.delete(key)
  })
  return result
}
