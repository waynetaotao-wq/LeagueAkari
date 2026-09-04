import { type MaybeRefOrGetter, onBeforeUnmount, shallowReactive, toValue, watch } from 'vue'

import type { ReviewPosition } from './types'

export const REVIEW_STORAGE_NAMESPACE = 'review-studio'
export const MAX_REVIEW_NOTE_LENGTH = 4000

export interface ReviewStorageAdapter {
  get(namespace: string, key: string, defaultValue?: unknown): Promise<unknown>
  set(namespace: string, key: string, value: unknown): Promise<unknown>
}

export interface ReviewArchiveScope {
  ownerPuuid: string
  ownerServerId: string
  targetPuuid: string
  targetServerId: string
}

export interface ReviewNotesScope extends ReviewArchiveScope {
  championId: number
  position: ReviewPosition
  opponentChampionId: number | null
}

export type ReviewNoteStatus = 'idle' | 'loading' | 'unsaved' | 'saving' | 'saved' | 'error'

export interface ReviewNoteState {
  text: string
  status: ReviewNoteStatus
  error: string | null
}

interface NoteEntry {
  key: string
  text: string
  revision: number
  savedRevision: number
  loading: boolean
  loaded: boolean
  error: string | null
  queuedRevisions: Set<number>
  timer: ReturnType<typeof setTimeout> | null
}

export function reviewScopeKey(scope: ReviewArchiveScope): string {
  const identity = [scope.ownerPuuid, scope.ownerServerId, scope.targetPuuid, scope.targetServerId]
  if (identity.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error('登录账号或目标玩家信息不完整')
  }
  return JSON.stringify(identity)
}

export function reviewNotesKey(scope: ReviewNotesScope): string {
  reviewScopeKey(scope)
  if (
    !Number.isInteger(scope.championId) ||
    scope.championId <= 0 ||
    !['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN'].includes(scope.position) ||
    (scope.opponentChampionId !== null &&
      (!Number.isInteger(scope.opponentChampionId) || scope.opponentChampionId <= 0))
  ) {
    throw new Error('对位笔记信息不完整')
  }
  return `notes:${JSON.stringify([
    scope.ownerPuuid,
    scope.ownerServerId,
    scope.targetPuuid,
    scope.targetServerId,
    scope.championId,
    scope.position,
    scope.opponentChampionId
  ])}`
}

/** Captures each scope before asynchronous work; a late read can never replace a local edit. */
export class ReviewNotesController {
  readonly state = shallowReactive<ReviewNoteState>({ text: '', status: 'idle', error: null })
  private readonly entries = new Map<string, NoteEntry>()
  private current: NoteEntry | null = null
  private writes: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(
    private readonly storage: ReviewStorageAdapter,
    private readonly debounceMs = 600
  ) {}

  select(scope: ReviewNotesScope | null): Promise<void> {
    if (this.disposed) return Promise.resolve()
    const key = scope ? reviewNotesKey(scope) : null
    if (key === this.current?.key) return Promise.resolve()
    if (this.current) void this.save(this.current)
    this.current = null
    if (!key) {
      this.reflect()
      return Promise.resolve()
    }
    let entry = this.entries.get(key)
    if (!entry) {
      entry = {
        key,
        text: '',
        revision: 0,
        savedRevision: 0,
        loading: false,
        loaded: false,
        error: null,
        queuedRevisions: new Set(),
        timer: null
      }
      this.entries.set(key, entry)
    }
    this.current = entry
    this.reflect()
    return !entry.loaded && !entry.loading ? this.read(entry) : Promise.resolve()
  }

  update(text: string): void {
    const entry = this.current
    if (!entry || this.disposed) return
    const nextText = text.slice(0, MAX_REVIEW_NOTE_LENGTH)
    if (entry.text === nextText && (entry.loaded || entry.revision > 0)) return
    entry.text = nextText
    entry.revision += 1
    entry.error = null
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => void this.save(entry), Math.max(0, this.debounceMs))
    this.reflect()
  }

  retry(): Promise<void> {
    const entry = this.current
    if (!entry) return Promise.resolve()
    if (entry.revision > entry.savedRevision) return this.save(entry)
    return this.read(entry)
  }

  async flush(): Promise<void> {
    for (const entry of this.entries.values()) void this.save(entry)
    await this.writes
  }

  /** Flushes pending text on close. Storage failures are retained, never leaked as rejections. */
  dispose(): Promise<void> {
    this.disposed = true
    return this.flush()
  }

  private reflect(): void {
    const entry = this.current
    if (!entry) {
      Object.assign(this.state, { text: '', status: 'idle', error: null })
      return
    }
    this.state.text = entry.text
    this.state.error = entry.error
    this.state.status = entry.error
      ? 'error'
      : entry.revision > entry.savedRevision
        ? entry.queuedRevisions.has(entry.revision)
          ? 'saving'
          : 'unsaved'
        : entry.loading || !entry.loaded
          ? 'loading'
          : 'saved'
  }

  private async read(entry: NoteEntry): Promise<void> {
    if (entry.loading) return
    entry.loading = true
    entry.error = null
    this.reflect()
    try {
      const stored = await this.storage.get(REVIEW_STORAGE_NAMESPACE, entry.key, null)
      let text = ''
      if (stored !== null && stored !== undefined) {
        if (
          typeof stored !== 'object' ||
          !('version' in stored) ||
          stored.version !== 1 ||
          !('text' in stored) ||
          typeof stored.text !== 'string' ||
          stored.text.length > MAX_REVIEW_NOTE_LENGTH
        ) {
          throw new Error('笔记格式无法读取，请重试')
        }
        text = stored.text
      }
      entry.loaded = true
      if (entry.revision === 0) entry.text = text
    } catch (error) {
      // The edited text may already have been saved while the original read was pending.
      if (entry.revision === 0) entry.error = `读取失败：${String(error)}`
    } finally {
      entry.loading = false
      this.reflect()
    }
  }

  private save(entry: NoteEntry): Promise<void> {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = null
    const revision = entry.revision
    if (revision <= entry.savedRevision || entry.queuedRevisions.has(revision)) return this.writes
    const text = entry.text
    entry.queuedRevisions.add(revision)
    entry.error = null
    this.reflect()
    this.writes = this.writes.then(async () => {
      try {
        await this.storage.set(REVIEW_STORAGE_NAMESPACE, entry.key, {
          version: 1,
          text,
          updatedAt: Date.now()
        })
        entry.savedRevision = revision
        entry.loaded = true
        entry.error = null
      } catch (error) {
        entry.error = `保存失败：${String(error)}`
      } finally {
        entry.queuedRevisions.delete(revision)
        this.reflect()
      }
    })
    return this.writes
  }
}

export function useReviewNotes(
  storage: ReviewStorageAdapter,
  scope: MaybeRefOrGetter<ReviewNotesScope | null>,
  debounceMs = 600
) {
  const controller = new ReviewNotesController(storage, debounceMs)
  watch(
    () => toValue(scope),
    (value) => void controller.select(value),
    { immediate: true }
  )
  onBeforeUnmount(() => void controller.dispose())
  return {
    state: controller.state,
    update: (text: string) => controller.update(text),
    retry: () => controller.retry(),
    flush: () => controller.flush()
  }
}
