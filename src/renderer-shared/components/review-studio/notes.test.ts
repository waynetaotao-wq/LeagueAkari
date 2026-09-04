import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  REVIEW_STORAGE_NAMESPACE,
  ReviewNotesController,
  type ReviewNotesScope,
  type ReviewStorageAdapter,
  reviewNotesKey
} from './notes'

const scope: ReviewNotesScope = {
  ownerPuuid: 'my-account',
  ownerServerId: 'HN1',
  targetPuuid: 'studied-player',
  targetServerId: 'KR',
  championId: 238,
  position: 'MIDDLE',
  opponentChampionId: 103
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function storage(): ReviewStorageAdapter {
  const records = new Map<string, unknown>()
  return {
    get: vi.fn(async (_namespace, key, fallback) => records.get(key) ?? fallback),
    set: vi.fn(async (_namespace, key, value) => records.set(key, value))
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('review notes persistence', () => {
  it('keeps typing when the initial saved note arrives late', async () => {
    const pending = deferred<unknown>()
    const adapter = storage()
    vi.mocked(adapter.get).mockReturnValueOnce(pending.promise)
    const notes = new ReviewNotesController(adapter)
    const loading = notes.select(scope)
    expect(notes.state.status).toBe('loading')
    notes.update('新写的对线笔记')
    await notes.flush()
    pending.resolve({ version: 1, text: '旧内容' })
    await loading
    expect(notes.state).toEqual({ text: '新写的对线笔记', status: 'saved', error: null })
    expect(adapter.set).toHaveBeenCalledWith(
      REVIEW_STORAGE_NAMESPACE,
      reviewNotesKey(scope),
      expect.objectContaining({ version: 1, text: '新写的对线笔记' })
    )
  })

  it('an explicit clear during loading is saved and is not replaced by a late read', async () => {
    const pending = deferred<unknown>()
    const adapter = storage()
    vi.mocked(adapter.get).mockReturnValueOnce(pending.promise)
    const notes = new ReviewNotesController(adapter)
    const loading = notes.select(scope)
    notes.update('')
    await notes.flush()
    pending.resolve({ version: 1, text: '旧内容' })
    await loading
    expect(notes.state).toEqual({ text: '', status: 'saved', error: null })
    expect(adapter.set).toHaveBeenCalledWith(
      REVIEW_STORAGE_NAMESPACE,
      reviewNotesKey(scope),
      expect.objectContaining({ text: '' })
    )
  })

  it('debounces edits and serializes revisions without an old save replacing newer text', async () => {
    vi.useFakeTimers()
    const pending = deferred<unknown>()
    const adapter = storage()
    vi.mocked(adapter.set).mockReturnValueOnce(pending.promise)
    const notes = new ReviewNotesController(adapter, 100)
    await notes.select(scope)
    notes.update('第一版')
    notes.update('第二版')
    await vi.advanceTimersByTimeAsync(100)
    expect(adapter.set).toHaveBeenCalledTimes(1)
    notes.update('第三版')
    await vi.advanceTimersByTimeAsync(100)
    expect(adapter.set).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    await notes.flush()
    expect(
      vi.mocked(adapter.set).mock.calls.map((call) => (call[2] as { text: string }).text)
    ).toEqual(['第二版', '第三版'])
    expect(notes.state.text).toBe('第三版')
    expect(notes.state.status).toBe('saved')
  })

  it('saves the old scope under its captured key when switching opponents or accounts', async () => {
    const adapter = storage()
    const pending = deferred<unknown>()
    vi.mocked(adapter.set).mockReturnValueOnce(pending.promise)
    const notes = new ReviewNotesController(adapter)
    const other = { ...scope, ownerPuuid: 'other-account', opponentChampionId: 7 }
    await notes.select(scope)
    notes.update('阿狸对位笔记')
    await notes.select(other)
    notes.update('妖姬对位笔记')
    const flushed = notes.flush()
    await Promise.resolve()
    expect(adapter.set).toHaveBeenCalledTimes(1)
    pending.resolve(undefined)
    await flushed
    const calls = vi.mocked(adapter.set).mock.calls
    expect(calls[0][1]).toBe(reviewNotesKey(scope))
    expect(calls[0][2]).toMatchObject({ text: '阿狸对位笔记' })
    expect(calls[1][1]).toBe(reviewNotesKey(other))
    expect(calls[1][2]).toMatchObject({ text: '妖姬对位笔记' })
    expect(notes.state.text).toBe('妖姬对位笔记')
  })

  it('retains failed text and supports explicit retry without leaking a rejection', async () => {
    const adapter = storage()
    vi.mocked(adapter.set).mockRejectedValueOnce(new Error('disk unavailable'))
    const notes = new ReviewNotesController(adapter)
    await notes.select(scope)
    notes.update('保留这段内容')
    await expect(notes.flush()).resolves.toBeUndefined()
    expect(notes.state.status).toBe('error')
    expect(notes.state.text).toBe('保留这段内容')
    await notes.retry()
    expect(notes.state.status).toBe('saved')
    expect(adapter.set).toHaveBeenCalledTimes(2)
  })

  it('a failed original read does not undo a successful concurrent save', async () => {
    const pending = deferred<unknown>()
    const adapter = storage()
    vi.mocked(adapter.get).mockReturnValueOnce(pending.promise)
    const notes = new ReviewNotesController(adapter)
    const loading = notes.select(scope)
    notes.update('已保存')
    await notes.flush()
    pending.reject(new Error('stale read failed'))
    await loading
    expect(notes.state).toEqual({ text: '已保存', status: 'saved', error: null })
  })

  it('flushes edits on close and retries a failed read without overwriting another scope', async () => {
    const adapter = storage()
    vi.mocked(adapter.get).mockRejectedValueOnce(new Error('read failed'))
    const notes = new ReviewNotesController(adapter)
    await notes.select(scope)
    expect(notes.state.status).toBe('error')
    await notes.retry()
    expect(notes.state.status).toBe('saved')
    notes.update('关闭前最后一笔')
    await notes.dispose()
    expect(adapter.set).toHaveBeenCalledWith(
      REVIEW_STORAGE_NAMESPACE,
      reviewNotesKey(scope),
      expect.objectContaining({ text: '关闭前最后一笔' })
    )
    notes.update('关闭后不能修改')
    expect(notes.state.text).toBe('关闭前最后一笔')
  })

  it('isolates every identity and matchup field, including unknown opponent', () => {
    const scopes = [
      scope,
      { ...scope, ownerPuuid: 'another' },
      { ...scope, ownerServerId: 'EUW' },
      { ...scope, targetPuuid: 'another' },
      { ...scope, targetServerId: 'EUW' },
      { ...scope, championId: 7 },
      { ...scope, position: 'TOP' as const },
      { ...scope, opponentChampionId: null }
    ]
    expect(new Set(scopes.map(reviewNotesKey)).size).toBe(scopes.length)
  })
})
