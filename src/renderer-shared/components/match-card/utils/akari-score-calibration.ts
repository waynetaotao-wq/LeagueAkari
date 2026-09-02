/**
 * [lolps] 对局评分权重校准（数据驱动）
 *
 * 思路与 OP.GG 一致：用真实对局结果拟合"哪些相对指标真正预测胜负"。
 * - 样本：玩家历史战绩里每局 10 人的相对指标（computeAkariMetrics 产物）+ 胜负
 * - 模型：按位置各拟合一个 L2 正则逻辑回归（特征 = 指标比率 − 1，标准化）
 * - 权重：取系数的正部并归一（指标皆为"越大越好"的口径，负系数视为噪声压到 0）
 * - 收缩：w = n/(n+K)·拟合 + K/(n+K)·先验，K=300，样本少时自动贴近先验，防过拟合
 * - 缺项：某位置某指标出现率 < 60% 时不拟合，沿用先验
 *
 * 纯函数，无副作用；渲染层拉取战绩后调用，结果持久化到设置。
 */
import {
  AKARI_POSITION_WEIGHTS,
  type AkariMetricKey,
  type AkariMetricSample,
  type AkariPositionWeights,
  type AkariScorePosition
} from './akari-score'

export const CALIBRATION_METRIC_KEYS: AkariMetricKey[] = [
  'damage', 'tank', 'support', 'kp', 'survival', 'gold',
  'cs', 'vision', 'cc', 'objective', 'lane', 'efficiency'
]
const FITTED_POSITIONS: AkariScorePosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

export interface CalibrationOptions {
  /** 收缩强度：样本数达到 K 时拟合与先验各占一半 */
  shrinkage?: number
  /** L2 正则强度 */
  l2?: number
  iterations?: number
  learningRate?: number
  /** 指标出现率低于此值不拟合 */
  minPresence?: number
  /** 位置样本少于此值整组沿用先验 */
  minSamples?: number
}

export interface CalibrationPositionReport {
  samples: number
  /** 拟合后在样本内的胜负预测准确率（0.5 = 无信息） */
  accuracy: number
  /** 参与拟合的指标 */
  fittedKeys: AkariMetricKey[]
}

export interface CalibrationResult {
  weights: AkariPositionWeights
  report: Record<AkariScorePosition, CalibrationPositionReport>
  totalSamples: number
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x))
}

function normalizeWeights(row: Record<AkariMetricKey, number>): Record<AkariMetricKey, number> {
  const sum = CALIBRATION_METRIC_KEYS.reduce((s, k) => s + Math.max(0, row[k] ?? 0), 0)
  const out = {} as Record<AkariMetricKey, number>
  for (const k of CALIBRATION_METRIC_KEYS) out[k] = sum > 0 ? Math.max(0, row[k] ?? 0) / sum : 0
  return out
}

/** 标准化后的逻辑回归（批量梯度下降），返回各特征系数 */
function fitLogistic(
  X: number[][],
  y: number[],
  l2: number,
  iterations: number,
  learningRate: number
): { coef: number[]; accuracy: number } {
  const n = X.length
  const m = X[0]?.length ?? 0
  if (n === 0 || m === 0) return { coef: [], accuracy: 0.5 }
  // 标准化
  const mean = new Array(m).fill(0)
  const std = new Array(m).fill(0)
  for (const row of X) for (let j = 0; j < m; j++) mean[j] += row[j] / n
  for (const row of X) for (let j = 0; j < m; j++) std[j] += (row[j] - mean[j]) ** 2 / n
  for (let j = 0; j < m; j++) std[j] = Math.sqrt(std[j]) || 1
  const Z = X.map((row) => row.map((v, j) => (v - mean[j]) / std[j]))

  const w = new Array(m).fill(0)
  let b = 0
  for (let it = 0; it < iterations; it++) {
    const gw = new Array(m).fill(0)
    let gb = 0
    for (let i = 0; i < n; i++) {
      let z = b
      for (let j = 0; j < m; j++) z += w[j] * Z[i][j]
      const err = sigmoid(z) - y[i]
      for (let j = 0; j < m; j++) gw[j] += err * Z[i][j]
      gb += err
    }
    for (let j = 0; j < m; j++) w[j] -= learningRate * (gw[j] / n + (l2 * w[j]) / n)
    b -= learningRate * (gb / n)
  }
  let correct = 0
  for (let i = 0; i < n; i++) {
    let z = b
    for (let j = 0; j < m; j++) z += w[j] * Z[i][j]
    if ((sigmoid(z) >= 0.5 ? 1 : 0) === y[i]) correct++
  }
  // 系数换回原尺度的可比重要性：|β_j / std_j|·std_j = |β_j|（标准化后系数即为"每一个标准差的影响"）
  return { coef: w, accuracy: correct / n }
}

export function fitAkariWeights(
  samples: AkariMetricSample[],
  prior: AkariPositionWeights = AKARI_POSITION_WEIGHTS,
  options: CalibrationOptions = {}
): CalibrationResult {
  const {
    shrinkage = 300,
    l2 = 1,
    iterations = 400,
    learningRate = 0.1,
    minPresence = 0.6,
    minSamples = 40
  } = options

  const weights = {} as AkariPositionWeights
  const report = {} as Record<AkariScorePosition, CalibrationPositionReport>
  for (const pos of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN'] as const) {
    weights[pos] = { ...prior[pos] }
    report[pos] = { samples: 0, accuracy: 0.5, fittedKeys: [] }
  }

  let total = 0
  for (const pos of FITTED_POSITIONS) {
    const rows = samples.filter((s) => s.position === pos)
    total += rows.length
    report[pos].samples = rows.length
    if (rows.length < minSamples) continue

    const keys = CALIBRATION_METRIC_KEYS.filter(
      (k) => rows.filter((s) => typeof s.metrics[k] === 'number').length / rows.length >= minPresence
    )
    if (keys.length < 2) continue

    const X = rows.map((s) => keys.map((k) => Math.max(-1.5, Math.min(1.5, (s.metrics[k] ?? 1) - 1))))
    const y = rows.map((s) => (s.win ? 1 : 0))
    const { coef, accuracy } = fitLogistic(X, y, l2, iterations, learningRate)

    const fitted = { ...prior[pos] }
    keys.forEach((k, j) => {
      fitted[k] = Math.max(0, coef[j])
    })
    const fittedNorm = normalizeWeights(fitted)
    // 未拟合的指标保留先验；拟合项按收缩比例与先验混合
    const n = rows.length
    const alpha = n / (n + shrinkage)
    const blended = {} as Record<AkariMetricKey, number>
    for (const k of CALIBRATION_METRIC_KEYS) {
      blended[k] = keys.includes(k)
        ? alpha * fittedNorm[k] + (1 - alpha) * prior[pos][k]
        : prior[pos][k]
    }
    weights[pos] = normalizeWeights(blended)
    report[pos] = { samples: n, accuracy, fittedKeys: keys }
  }

  // 通用（位置未知）权重：取五个位置校准结果的平均，位置缺失的 LCU 路径也能受益
  const generic = {} as Record<AkariMetricKey, number>
  for (const k of CALIBRATION_METRIC_KEYS) {
    generic[k] = FITTED_POSITIONS.reduce((s, p) => s + weights[p][k], 0) / FITTED_POSITIONS.length
  }
  weights.UNKNOWN = normalizeWeights(generic)

  return { weights, report, totalSamples: total }
}

/** 序列化 / 反序列化（设置项里存 JSON 字符串） */
export interface StoredCalibration {
  version: 1
  calibratedAt: number
  games: number
  totalSamples: number
  weights: AkariPositionWeights
  report: Record<AkariScorePosition, CalibrationPositionReport>
  /** 校准所用战绩的来源账号（换号后用于提示；缺省兼容旧数据） */
  sourcePuuid?: string
  sourceName?: string
}

export function parseStoredCalibration(json: string | null | undefined): StoredCalibration | null {
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as StoredCalibration
    if (parsed?.version !== 1 || !parsed.weights) return null
    for (const pos of ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN'] as const) {
      const row = parsed.weights[pos]
      if (!row) return null
      for (const k of CALIBRATION_METRIC_KEYS) {
        if (typeof row[k] !== 'number' || !Number.isFinite(row[k]) || row[k] < 0) return null
      }
    }
    return parsed
  } catch {
    return null
  }
}
