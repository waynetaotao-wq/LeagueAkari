import type { ReviewPosition } from './types'

// [lolps] 教练资料包各部分共用的写法：位置怎么称呼、时间和数字怎么写。
// 缺的数一律写「未知」，不写 0。

/** Names as the client shows them; the document builder never looks anything up by itself. */
export interface ReviewCoachNames {
  champion(id: number): string
  item(id: number): string
  perk(id: number): string
  spell(id: number): string
  queue(id: number): string
}

export const POSITION: Record<ReviewPosition, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助',
  UNKNOWN: '位置未知'
}

/** 表格里每一格前面标的位置。 */
export const ROLE_TAG: Record<ReviewPosition, string> = {
  TOP: '上',
  JUNGLE: '野',
  MIDDLE: '中',
  BOTTOM: '下',
  UTILITY: '辅',
  UNKNOWN: '?'
}

const ROLE_ORDER: ReviewPosition[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY', 'UNKNOWN']
export const roleOrder = (position: ReviewPosition) => ROLE_ORDER.indexOf(position)

/**
 * 和游戏里的计时、和复盘页其它地方（reviewClock）一样，只舍不入：4:40.6 写作 4:40。
 * 四舍五入的话，同一个时刻在教练的回答里和在报告页里会差一秒，最后一张快照还会比对局时长晚一秒。
 */
export const clock = (timestamp: number) => {
  const seconds = Math.max(0, Math.floor(timestamp / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
export const whole = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '未知' : String(Math.round(value))
export const signed = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '未知'
    : `${Math.round(value) > 0 ? '+' : ''}${Math.round(value)}`
/**
 * 23/40 这样的比例乘以 100 得到的是 57.49999999999999，直接取整会把 57.5% 写成 57%。
 * 取整前补上一点点，让刚好落在半个点上的数照常进位。
 */
const ROUNDING_SLACK = 1e-9
export const percent = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value) ? '未知' : `${Math.round(value * 100 + ROUNDING_SLACK)}%`
/** A percentage with one decimal, for win rates where a point matters. */
export const percentFine = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '未知'
    : `${Math.round(value * 1000 + ROUNDING_SLACK) / 10}%`
export const decimal = (value: number) => String(Number(value.toFixed(1)))
