import { describe, expect, it } from 'vitest'

import {
  AKARI_POSITION_WEIGHTS,
  type AkariMetricKey,
  type AkariMetricSample,
  type AkariScorePosition
} from './akari-score'
import {
  CALIBRATION_METRIC_KEYS,
  fitAkariWeights,
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
      win: z > 0,
      metrics,
      bonus: 0,
      afkTeammate: false
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
    expect(report.JUNGLE.accuracy).toBeGreaterThan(0.75)
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
    const json = JSON.stringify({
      version: 1,
      calibratedAt: 1,
      games: 20,
      totalSamples,
      weights,
      report
    })
    expect(parseStoredCalibration(json)?.weights.TOP).toEqual(weights.TOP)
    expect(parseStoredCalibration('{"version":2}')).toBeNull()
    expect(parseStoredCalibration('not json')).toBeNull()
    expect(parseStoredCalibration(null)).toBeNull()
  })
})
