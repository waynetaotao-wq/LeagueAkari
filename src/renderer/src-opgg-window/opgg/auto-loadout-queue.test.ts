import { describe, expect, it } from 'vitest'

import { createLatestWinsAsyncQueue } from './auto-loadout-queue'

function createDeferred() {
  let resolve!: () => void
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

describe('createLatestWinsAsyncQueue', () => {
  it('runs the latest task after an older running task finishes', async () => {
    const queue = createLatestWinsAsyncQueue()
    const firstStarted = createDeferred()
    const releaseFirst = createDeferred()
    const events: string[] = []

    const first = queue.enqueue(async () => {
      events.push('first-start')
      firstStarted.resolve()
      await releaseFirst.promise
      events.push('first-end')
    })

    await firstStarted.promise
    const latest = queue.enqueue(() => {
      events.push('latest')
    })

    expect(events).toEqual(['first-start'])
    releaseFirst.resolve()

    await expect(first).resolves.toBe('completed')
    await expect(latest).resolves.toBe('completed')
    expect(events).toEqual(['first-start', 'first-end', 'latest'])
  })

  it('skips an intermediate pending task when newer work is enqueued', async () => {
    const queue = createLatestWinsAsyncQueue()
    const firstStarted = createDeferred()
    const releaseFirst = createDeferred()
    const events: string[] = []

    const first = queue.enqueue(async () => {
      events.push('first')
      firstStarted.resolve()
      await releaseFirst.promise
    })

    await firstStarted.promise
    const intermediate = queue.enqueue(() => {
      events.push('intermediate')
    })
    const latest = queue.enqueue(() => {
      events.push('latest')
    })

    releaseFirst.resolve()

    await expect(first).resolves.toBe('completed')
    await expect(intermediate).resolves.toBe('skipped')
    await expect(latest).resolves.toBe('completed')
    expect(events).toEqual(['first', 'latest'])
  })

  it('continues with the latest task after an older task rejects', async () => {
    const queue = createLatestWinsAsyncQueue()
    const firstStarted = createDeferred()
    const releaseFirst = createDeferred()
    const failure = new Error('loadout write failed')
    const events: string[] = []

    const first = queue.enqueue(async () => {
      firstStarted.resolve()
      await releaseFirst.promise
      throw failure
    })
    const observedFirst = first.catch((error: unknown) => error)

    await firstStarted.promise
    const latest = queue.enqueue(() => {
      events.push('latest')
    })
    releaseFirst.resolve()

    expect(await observedFirst).toBe(failure)
    await expect(latest).resolves.toBe('completed')
    expect(events).toEqual(['latest'])
  })

  it('invalidates work that has not started yet', async () => {
    const queue = createLatestWinsAsyncQueue()
    const firstStarted = createDeferred()
    const releaseFirst = createDeferred()
    const events: string[] = []

    const first = queue.enqueue(async () => {
      firstStarted.resolve()
      await releaseFirst.promise
    })

    await firstStarted.promise
    const pending = queue.enqueue(() => {
      events.push('pending')
    })
    queue.invalidate()
    releaseFirst.resolve()

    await expect(first).resolves.toBe('completed')
    await expect(pending).resolves.toBe('skipped')
    expect(events).toEqual([])
  })
})
