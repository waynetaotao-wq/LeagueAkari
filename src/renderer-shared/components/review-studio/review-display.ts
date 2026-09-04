import dayjs from 'dayjs'

import type { ReviewPosition } from './types'

export const REVIEW_POSITION_LABELS: Record<ReviewPosition, string> = {
  TOP: '上单',
  JUNGLE: '打野',
  MIDDLE: '中单',
  BOTTOM: '下路',
  UTILITY: '辅助',
  UNKNOWN: '位置未知'
}

export function reviewSigned(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? '+' : ''}${rounded.toLocaleString('zh-CN', { maximumFractionDigits: digits })}`
}

export function reviewPercent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(0)}%`
}

export function reviewDate(timestamp: number): string {
  return Number.isFinite(timestamp) && timestamp > 0
    ? dayjs(timestamp).format('MM-DD HH:mm')
    : '日期未知'
}

export function reviewClock(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(timestamp / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
