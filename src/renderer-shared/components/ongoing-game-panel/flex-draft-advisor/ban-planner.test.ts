import { describe, expect, it } from 'vitest'

import { planBanSequence } from './ban-planner'

interface Row {
  championId: number
  score: number
}

const total = (rows: readonly Row[]) => rows.reduce((sum, row) => sum + row.score, 0)

function exhaustive(
  ids: readonly number[],
  budget: number,
  score: (id: number, removed: readonly number[]) => number
) {
  let best = -Infinity
  const visit = (removed: number[], value: number) => {
    if (removed.length === budget || removed.length === ids.length) {
      best = Math.max(best, value)
      return
    }
    for (const id of ids)
      if (!removed.includes(id)) visit([...removed, id], value + score(id, removed))
  }
  visit([], 0)
  return best
}

describe('conditional ban sequence planning', () => {
  it('matches independent enumeration of all orders for small pools and each available budget', () => {
    const ids = [1, 2, 3, 4, 5]
    const score = (id: number, removed: readonly number[]) =>
      [0, 0.18, 0.18, 0.25, 0.12, 0.1][id] +
      ((id === 1 && removed.includes(2)) || (id === 2 && removed.includes(1)) ? 0.3 : 0)
    const evaluate = (removed: readonly number[]) =>
      ids
        .filter((id) => !removed.includes(id))
        .map((championId) => ({ championId, score: score(championId, removed) }))
        .sort((a, b) => b.score - a.score || a.championId - b.championId)
    for (const budget of [1, 2, 3]) {
      const result = planBanSequence(budget, evaluate)
      expect(result).toHaveLength(budget)
      expect(total(result)).toBeCloseTo(exhaustive(ids, budget, score))
    }
    expect(planBanSequence(2, evaluate).map((row) => row.championId)).toEqual([1, 2])
  })

  it('retains the complete greedy result when bounded search drops its winning prefix', () => {
    const ids = Object.freeze(Array.from({ length: 125 }, (_, index) => index + 1))
    const score = (id: number, removed: readonly number[]) => {
      if (!removed.length) return id === 1 ? 0.3 : id === 2 ? 0.29 : 0.01
      if (removed.length === 1 && removed[0] === 1 && id === 3) return 0.2
      if (removed.length === 1 && removed[0] === 2) return id === 4 ? 0.25 : id === 5 ? 0.24 : 0.01
      if (removed.length === 2 && removed.includes(1) && removed.includes(3) && id === 6) return 0.9
      return 0.01
    }
    const queries: string[] = []
    const evaluate = (removed: readonly number[]) => {
      queries.push([...removed].sort((a, b) => a - b).join(','))
      return ids
        .filter((id) => !removed.includes(id))
        .map((championId) => Object.freeze({ championId, score: score(championId, removed) }))
        .sort((a, b) => b.score - a.score || a.championId - b.championId)
    }
    const result = planBanSequence(3, evaluate)
    expect(result.map((row) => row.championId)).toEqual([1, 3, 6])
    expect(queries.length).toBeLessThan(20)
    expect(new Set(queries).size).toBe(queries.length)
    expect(planBanSequence(3, evaluate)).toEqual(result)
    expect(ids).toEqual(Array.from({ length: 125 }, (_, index) => index + 1))
  })
})
