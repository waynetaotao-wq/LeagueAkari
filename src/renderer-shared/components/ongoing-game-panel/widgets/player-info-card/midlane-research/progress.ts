import type { MidResearchState } from './context'

export function researchProgressText(state: MidResearchState) {
  if (state.phase === 'list') return `拉取战绩 ${state.progressDone}/${state.progressTotal}…`
  if (state.phase === 'deep') return `分析时间线 ${state.progressDone}/${state.progressTotal}…`
  if (state.phase === 'error') return '中单研究获取失败'
  if (state.phase === 'done' && state.result?.deep.timelineFailures)
    return `时间线失败或不完整（${state.result.deep.timelineFailures} 场）`
  if (state.phase === 'done') return '没有符合条件的中路对局'
  return '中单研究准备中…'
}
