interface ScoredBan {
  championId: number
  score: number
}

interface Plan<T> {
  steps: T[]
  score: number
}

const stateKey = (ids: readonly number[]) => [...ids].sort((a, b) => a - b).join(',')

function comparePlans<T extends ScoredBan>(a: Plan<T>, b: Plan<T>) {
  if (a.score !== b.score) return b.score - a.score
  for (let index = 0; index < Math.min(a.steps.length, b.steps.length); index++) {
    const order = a.steps[index].championId - b.steps[index].championId
    if (order) return order
  }
  return a.steps.length - b.steps.length
}

/**
 * Maximize the sum of existing conditional ban scores over at most three steps.
 * The evaluator must return ranked rows and depend only on the removed set.
 * Small pools are exhaustive; larger pools use deterministic bounded frontiers.
 */
export function planBanSequence<T extends ScoredBan>(
  budget: number,
  evaluate: (removed: readonly number[]) => readonly T[]
): T[] {
  const depthLimit = Math.min(3, budget)
  if (depthLimit <= 0) return []
  const cache = new Map<string, readonly T[]>()
  const rowsFor = (steps: readonly T[]) => {
    const ids = steps.map((step) => step.championId)
    const key = stateKey(ids)
    if (!cache.has(key)) cache.set(key, evaluate(ids))
    return cache.get(key)!
  }

  const count = rowsFor([]).length
  const width = count <= 15 ? Infinity : count <= 60 ? 4 : 2
  let greedy: Plan<T> = { steps: [], score: 0 }
  for (let depth = 0; depth < depthLimit; depth++) {
    const next = rowsFor(greedy.steps)[0]
    if (!next) break
    greedy = { steps: [...greedy.steps, next], score: greedy.score + next.score }
  }
  // Bounded search can prune a promising prefix. Always retain the complete old plan.
  let best = greedy
  let frontier: Plan<T>[] = [{ steps: [], score: 0 }]
  for (let depth = 0; depth < depthLimit; depth++) {
    const expanded = new Map<string, Plan<T>>()
    for (const plan of frontier) {
      const rows = rowsFor(plan.steps)
      if (!rows.length && plan.score > best.score) best = plan
      for (const row of rows) {
        const next = { steps: [...plan.steps, row], score: plan.score + row.score }
        const key = stateKey(next.steps.map((step) => step.championId))
        const previous = expanded.get(key)
        // Future scores depend on the removed set, so a weaker path to it is dominated.
        if (!previous || comparePlans(next, previous) < 0) expanded.set(key, next)
      }
    }
    const ordered = [...expanded.values()].sort(comparePlans)
    if (depth === depthLimit - 1) {
      if (ordered[0] && ordered[0].score > best.score) best = ordered[0]
    } else frontier = ordered.slice(0, width)
  }
  return best.steps
}
