import { shallowRef } from 'vue'

/**
 * [lolps] 对位覆盖状态（模块单例）
 *
 * OpggCounterIntel 识别对位并拉取官方形状 overlay 后写入这里；
 * OpggView 就近 provide 覆盖 champion（merge overlay），
 * 全部区块子组件与"应用"按钮自动吃对位版数据，UI 零改动。
 */

/** 官方形状 data 子集（runes/summoner_spells/starter_items/boots/core_items/last_items） */
export const matchupOverlay = shallowRef<Record<string, unknown> | null>(null)

/** 状态描述（克制助手面板显示："已切换为对位版 vs XX" 等） */
export const matchupOverlayLabel = shallowRef<string>('')

export function setMatchupOverlay(patch: Record<string, unknown> | null, label = '') {
  matchupOverlay.value = patch && Object.keys(patch).length > 0 ? patch : null
  matchupOverlayLabel.value = matchupOverlay.value ? label : ''
}

export function useMatchupOverlay() {
  return { matchupOverlay, matchupOverlayLabel, setMatchupOverlay }
}
