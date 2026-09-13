import type { MidDeepResult } from './analysis'
import { LEVEL_BUCKETS } from './analysis'

export interface MidlaneSignal {
  kind: 'roam' | 'solo' | 'lane'
  title: string
  evidence: string
  callout: string
}

export interface MidlaneBriefing {
  status: 'insufficient' | 'incomplete' | 'signals' | 'neutral'
  headline: string
  callout: string
  signals: MidlaneSignal[]
}

/** 展示门槛只是保守筛选规则，不是预测准确率或统计显著性。 */
const MIN_GAMES = 10
const MAX_FAILURE_SHARE = 0.3

export function buildMidlaneBriefing(d: MidDeepResult): MidlaneBriefing {
  if (d.deepGames < MIN_GAMES) {
    return {
      status: 'insufficient',
      headline: '样本少，先别定型',
      callout: `只有 ${d.deepGames} 场有效记录，先按这局表现判断。`,
      signals: []
    }
  }
  if (d.timelineFailures / (d.deepGames + d.timelineFailures) > MAX_FAILURE_SHARE) {
    return {
      status: 'incomplete',
      headline: '缺失多，先别定型',
      callout: '时间线缺失较多，暂不据此判断他的习惯。',
      signals: []
    }
  }

  const signals: MidlaneSignal[] = []
  // 用“有游走的对局数”判断频度，以每局首次去向判偏向，避免一局反复游走放大某侧。
  if (d.roamGames >= 8 && d.roamGames / d.deepGames >= 0.5) {
    const direction = (['bot', 'top'] as const).find(
      (dir) => d.roamDirs[dir] >= 5 && d.roamDirs[dir] / d.roamGames >= 0.65
    )
    const side = direction === 'bot' ? '下' : '上'
    signals.push({
      kind: 'roam',
      title: direction ? `前期游走偏${side}` : '前期游走较多',
      evidence: `${d.roamGames}/${d.deepGames} 场有游走${direction ? `，其中 ${d.roamDirs[direction]} 场首次去${side}路` : '，首次去向较分散'}`,
      callout: direction
        ? `这人前期常往${side}走；中路消失，${side}路先防。`
        : '这人前期常去边路；中路消失，两边先防。'
    })
  }

  if (d.firstKillGames >= 5 && d.firstKillGames / d.deepGames >= 0.4) {
    const max = Math.max(...d.firstKillBuckets)
    const bucket = d.firstKillBuckets.indexOf(max)
    const level =
      max >= 4 &&
      max / d.firstKillGames >= 0.5 &&
      d.firstKillBuckets.filter((count) => count === max).length === 1
        ? LEVEL_BUCKETS[bucket]
        : null
    const levelText = level?.key === '6' ? '6级' : level?.label
    signals.push({
      kind: 'solo',
      title: level ? `前期单杀较多 · ${levelText}` : '前期单杀记录较多',
      evidence: `${d.firstKillGames}/${d.deepGames} 场有前期单杀${level ? `，${max} 场首次在 ${levelText}` : '（不限对手）'}`,
      callout: level
        ? `这人前期有单杀记录，首次多在 ${levelText}；对拼留退路。`
        : '这人前期单杀记录较多；别残血硬换，对拼留退路。'
    })
  }

  // 缺失的对线快照不能当作零，也不单凭一个大均值判断“对线强”。
  if (
    d.laneDiffGames >= MIN_GAMES &&
    d.laneDiffGames / d.deepGames >= 0.6 &&
    d.goldLead10Games / d.laneDiffGames >= 0.65 &&
    d.goldDiff10Sum / d.laneDiffGames >= 300
  ) {
    const averageGold = Math.round(d.goldDiff10Sum / d.laneDiffGames)
    signals.push({
      kind: 'lane',
      title: '10 分钟常有经济优势',
      evidence: `10 分钟经济 ${d.goldLead10Games}/${d.laneDiffGames} 场领先，场均 +${averageGold}`,
      callout: '这人历史上常拿前期经济优势；先看装备，再决定对拼。'
    })
  }

  return signals.length
    ? { status: 'signals', headline: signals[0].title, callout: signals[0].callout, signals }
    : {
        status: 'neutral',
        headline: '暂未发现突出倾向',
        callout: '历史记录暂未显示突出倾向，先按这局表现判断。',
        signals: []
      }
}
