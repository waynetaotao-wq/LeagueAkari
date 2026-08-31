export type LatestWinsTaskStatus = 'completed' | 'skipped'

export type LatestWinsAsyncQueue = {
  enqueue: (task: () => void | Promise<void>) => Promise<LatestWinsTaskStatus>
  invalidate: () => void
}

/**
 * Serializes automatic loadout writes while allowing only the newest pending write to run.
 * A task that already started is allowed to finish; the newest task then runs after it so that
 * the final client state belongs to the latest matchup.
 */
export function createLatestWinsAsyncQueue(): LatestWinsAsyncQueue {
  let generation = 0
  let tail: Promise<void> = Promise.resolve()

  const enqueue: LatestWinsAsyncQueue['enqueue'] = (task) => {
    const taskGeneration = ++generation
    const result = tail.then(async (): Promise<LatestWinsTaskStatus> => {
      if (taskGeneration !== generation) return 'skipped'

      await task()
      return 'completed'
    })

    // A failed write must not poison the serialization chain for the next, newer write.
    tail = result.then(
      () => undefined,
      () => undefined
    )

    return result
  }

  return {
    enqueue,
    invalidate: () => {
      generation++
    }
  }
}
