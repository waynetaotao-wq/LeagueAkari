import { describe, expect, it } from 'vitest'

import {
  AKARI_POSITION_WEIGHTS,
  type AkariMetricKey,
  type AkariMetricSample,
  type AkariScorePosition,
  rateAkariSample
} from './akari-score'
import {
  CALIBRATION_METRIC_KEYS,
  fitAkariWeights,
  fitAkariWeightsWithValidation,
  parseStoredCalibration
} from './akari-score-calibration'

/** 确定性伪随机（测试可复现） */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

/** 合成样本：胜负由指定指标主导（其余指标为噪声） */
function synth(
  position: AkariScorePosition,
  n: number,
  driver: AkariMetricKey,
  seed = 7
): AkariMetricSample[] {
  const rand = rng(seed)
  const out: AkariMetricSample[] = []
  for (let i = 0; i < n; i++) {
    const metrics: Partial<Record<AkariMetricKey, number>> = {}
    for (const k of CALIBRATION_METRIC_KEYS) metrics[k] = 0.6 + rand() * 0.8
    const z = (metrics[driver]! - 1) * 6 + (rand() - 0.5) * 1.5
    out.push({
      puuid: `${position}-${i}`,
      teamIdentifier: i % 2 ? 'A' : 'B',
      position,
      mode: 'sr',
      win: z > 0,
      metrics,
      bonus: 0,
      afkTeammate: false,
      kills: 0,
      surrender: false,
      gold: 0,
      turretTakedowns: 0
    })
  }
  return out
}

const sums = (row: Record<AkariMetricKey, number>) =>
  CALIBRATION_METRIC_KEYS.reduce((s, k) => s + row[k], 0)

describe('fitAkariWeights', () => {
  it('learns that the driving metric matters most for that position', () => {
    const samples = [...synth('JUNGLE', 1200, 'kp'), ...synth('BOTTOM', 1200, 'damage')]
    const { weights, report } = fitAkariWeights(samples)
    const jg = weights.JUNGLE
    const bot = weights.BOTTOM
    expect(Object.entries(jg).sort((a, b) => b[1] - a[1])[0][0]).toBe('kp')
    expect(Object.entries(bot).sort((a, b) => b[1] - a[1])[0][0]).toBe('damage')
    expect(report.JUNGLE.trainingAccuracy).toBeGreaterThan(0.75)
    expect(report.BOTTOM.samples).toBe(1200)
    for (const pos of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN'] as const) {
      expect(Math.abs(sums(weights[pos]) - 1)).toBeLessThan(1e-6)
    }
  })

  it('stays close to the prior when samples are scarce (shrinkage)', () => {
    const { weights } = fitAkariWeights(synth('TOP', 60, 'damage'), AKARI_POSITION_WEIGHTS, {
      shrinkage: 300
    })
    const prior = AKARI_POSITION_WEIGHTS.TOP
    const drift = CALIBRATION_METRIC_KEYS.reduce(
      (s, k) => s + Math.abs(weights.TOP[k] - prior[k]),
      0
    )
    expect(drift).toBeLessThan(0.45)
  })

  it('keeps prior weights for positions without enough samples and never yields negatives', () => {
    const { weights, report } = fitAkariWeights(synth('MIDDLE', 500, 'gold'))
    expect(weights.UTILITY).toEqual(AKARI_POSITION_WEIGHTS.UTILITY)
    expect(report.UTILITY.samples).toBe(0)
    expect(report.UTILITY.trainingAccuracy).toBeNull()
    for (const pos of Object.keys(weights) as AkariScorePosition[]) {
      for (const k of CALIBRATION_METRIC_KEYS) expect(weights[pos][k]).toBeGreaterThanOrEqual(0)
    }
  })

  it('skips metrics that are mostly missing and averages fitted positions into UNKNOWN', () => {
    const samples = synth('TOP', 400, 'damage').map((s) => {
      const metrics = { ...s.metrics }
      delete metrics.lane
      return { ...s, metrics }
    })
    const { weights, report } = fitAkariWeights(samples)
    expect(report.TOP.fittedKeys).not.toContain('lane')
    // 未拟合项沿用先验（整行再归一后允许微小缩放）
    expect(Math.abs(weights.TOP.lane - AKARI_POSITION_WEIGHTS.TOP.lane)).toBeLessThan(0.01)
    expect(Math.abs(sums(weights.UNKNOWN) - 1)).toBeLessThan(1e-6)
  })

  it('round-trips stored calibration and rejects malformed payloads', () => {
    const { weights, report, totalSamples } = fitAkariWeights(synth('TOP', 200, 'damage'))
    const stored = {
      version: 2,
      calibratedAt: 1,
      games: 20,
      trainingGames: 20,
      totalSamples,
      weights,
      report,
      validation: null
    }
    const json = JSON.stringify(stored)
    expect(parseStoredCalibration(json)?.weights.TOP).toEqual(weights.TOP)
    expect(parseStoredCalibration(JSON.stringify({ ...stored, version: 1 }))).toBeNull()
    expect(parseStoredCalibration(JSON.stringify({ version: 2, weights }))).toBeNull()
    expect(parseStoredCalibration(JSON.stringify({ ...stored, trainingGames: 21 }))).toBeNull()
    expect(parseStoredCalibration(JSON.stringify({ ...stored, report: {} }))).toBeNull()
    expect(parseStoredCalibration(JSON.stringify({ ...stored, totalSamples: -1 }))).toBeNull()
    const zeroWeights = {
      ...weights,
      TOP: Object.fromEntries(CALIBRATION_METRIC_KEYS.map((key) => [key, 0]))
    }
    expect(parseStoredCalibration(JSON.stringify({ ...stored, weights: zeroWeights }))).toBeNull()
    expect(parseStoredCalibration('{"version":2}')).toBeNull()
    expect(parseStoredCalibration('not json')).toBeNull()
    expect(parseStoredCalibration(null)).toBeNull()
  })

  it('restores standardized coefficients to the raw ratio scale before weighting', () => {
    const samples = synth('MIDDLE', 800, 'damage').map((sample, index) => {
      const win = index % 2 === 0
      const follows = index % 10 < 6
      return {
        ...sample,
        win,
        metrics: {
          damage: win ? 1.01 : 0.99,
          gold: (follows ? win : !win) ? 1.8 : 0.2
        }
      }
    })
    const original = fitAkariWeights(samples, AKARI_POSITION_WEIGHTS, {
      shrinkage: 0
    })
    const rescaled = fitAkariWeights(
      samples.map((sample) => ({
        ...sample,
        metrics: {
          ...sample.metrics,
          damage: 1 + (sample.metrics.damage - 1) / 100
        }
      })),
      AKARI_POSITION_WEIGHTS,
      { shrinkage: 0 }
    )
    const originalRatio = original.weights.MIDDLE.damage / original.weights.MIDDLE.gold
    const rescaledRatio = rescaled.weights.MIDDLE.damage / rescaled.weights.MIDDLE.gold
    expect(rescaledRatio / originalRatio).toBeCloseTo(100, 5)
    expect(original.report.MIDDLE.trainingAccuracy).toBe(1)
    for (let index = 0; index < samples.length; index += 2) {
      expect(rateAkariSample(samples[index], original.weights)).toBeGreaterThan(
        rateAkariSample(samples[index + 1], original.weights)
      )
    }
  })
})

function pairedGames(count: number) {
  const template = synth('MIDDLE', 1, 'damage')[0]
  return Array.from({ length: count }, (_, index) => ({
    gameId: index + 1,
    samples: [true, false].map((win) => ({
      ...template,
      puuid: `${index}-${win}`,
      teamIdentifier: win ? 'A' : 'B',
      win,
      metrics: {
        ...Object.fromEntries(CALIBRATION_METRIC_KEYS.map((key) => [key, 1])),
        damage: win ? 1.4 : 0.6
      }
    }))
  }))
}

describe('held-out calibration validation', () => {
  it('holds out complete games and evaluates the saved weights, including tied ratings', () => {
    const games = pairedGames(60)
    games[0].samples[1].metrics = { ...games[0].samples[0].metrics }
    const result = fitAkariWeightsWithValidation(games)
    expect(result.trainingGames).toBe(48)
    expect(result.totalSamples).toBe(96)
    expect(result.weights).toEqual(
      fitAkariWeights(games.slice(12).flatMap((game) => game.samples)).weights
    )
    expect(result.validation?.games).toBe(12)
    expect(result.validation?.comparisons).toBe(12)
    expect(result.validation?.winnerHigherRate).toBeCloseTo(11.5 / 12)
    const changedHoldout = games.map((game, index) =>
      index < 12
        ? {
            ...game,
            samples: game.samples.map((sample) => ({
              ...sample,
              win: !sample.win
            }))
          }
        : game
    )
    const changed = fitAkariWeightsWithValidation(changedHoldout)
    expect(changed.weights).toEqual(result.weights)
    expect(changed.validation?.winnerHigherRate).toBeCloseTo(0.5 / 12)
  })

  it('groups repeated game ids before splitting and leaves scarce samples unvalidated', () => {
    const games = pairedGames(60)
    const fragments = [0, 1].flatMap((member) =>
      games.map((game) => ({
        gameId: game.gameId,
        samples: [game.samples[member]]
      }))
    )
    expect(fitAkariWeightsWithValidation(fragments)).toEqual(fitAkariWeightsWithValidation(games))
    const small = fitAkariWeightsWithValidation(games.slice(0, 20))
    expect(small.trainingGames).toBe(20)
    expect(small.validation).toBeNull()
    expect(small.totalSamples).toBe(40)
  })
})
