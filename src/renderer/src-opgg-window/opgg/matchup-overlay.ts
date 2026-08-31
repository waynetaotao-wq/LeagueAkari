import type { LaneName } from '@shared/utils/lane-assignment'
import { shallowRef } from 'vue'

/**
 * [lolps] 对位覆盖状态（模块单例）
 *
 * OpggCounterIntel 识别对位并拉取官方形状 overlay 后写入这里；
 * OpggView 就近 provide 覆盖 champion（merge overlay），
 * 全部原版区块子组件与"应用"按钮自动吃对位版数据。
 */

/** 官方形状 data 子集（含技能与后续装备汇总；缺失对位区块会显式写成空数组） */
export const matchupOverlay = shallowRef<Record<string, unknown> | null>(null)

/** 状态描述（克制助手面板显示："已切换为对位版 vs XX" 等） */
export const matchupOverlayLabel = shallowRef<string>('')

/** 生成 overlay 时的完整对位身份，防止异步旧结果覆盖到新的英雄或分路。 */
export interface MatchupOverlayIdentity {
  /** LCU 对局 id；跨选人/加载/游戏保持一致，防止上一局单例 overlay 混入下一局。 */
  gameId: number
  myChampionId: number
  opponentChampionId: number
  lane: string
  region: string
  tier: string
  version: string | null
  mode: string
  source: string
}

/** 当前视图能确认的身份；未知字段不参与匹配，已知字段必须全部一致。 */
export interface MatchupOverlayViewIdentity {
  /** 显式传 null 表示当前没有活跃对局，此时必须拒绝任何旧 overlay。 */
  gameId?: number | null
  opponentChampionId?: number | null
  lane?: string | null
  region?: string | null
  tier?: string | number | null
  version?: string | null
  mode?: string | null
  source?: string | null
}

export const matchupOverlayIdentity = shallowRef<MatchupOverlayIdentity | null>(null)

export interface MatchupOverlayMeta {
  play: number
  win: number
  sourceVersion: string | null
}

export const matchupOverlayMeta = shallowRef<MatchupOverlayMeta | null>(null)

export type MatchupLoadoutSource = 'OP.GG' | 'OP.GG+BZ' | 'BZ'

export interface MatchupLoadoutIdentity {
  opponentChampionId: number
  source: MatchupLoadoutSource
}

const MATCHUP_LOADOUT_IDENTITY_KEY = '__lolps_matchup_loadout'

/** 从真正已 merge 的 champion.data 读取；基础/被身份守卫拒绝的视图不会带此标记。 */
export function getMatchupLoadoutIdentity(data: unknown): MatchupLoadoutIdentity | null {
  if (!data || typeof data !== 'object') return null
  const value = (data as Record<string, unknown>)[MATCHUP_LOADOUT_IDENTITY_KEY]
  if (!value || typeof value !== 'object') return null
  const opponentChampionId = (value as Record<string, unknown>).opponentChampionId
  const source = (value as Record<string, unknown>).source
  return typeof opponentChampionId === 'number' &&
    Number.isInteger(opponentChampionId) &&
    opponentChampionId > 0 &&
    (source === 'OP.GG' || source === 'OP.GG+BZ' || source === 'BZ')
    ? { opponentChampionId, source }
    : null
}

/** 发布 overlay 时显式记录来源；BZ 置顶既有行/筛符文时也不会因缺少合成行而漏标。 */
export function resolveMatchupLoadoutSource(
  hasOpgg: boolean,
  hasBz: boolean
): MatchupLoadoutSource | null {
  if (hasOpgg) return hasBz ? 'OP.GG+BZ' : 'OP.GG'
  return hasBz ? 'BZ' : null
}

export function formatMatchupLoadoutSuffix(
  opponentName: string,
  source: MatchupLoadoutSource
): string {
  return ` - vs ${opponentName} · ${source}`
}

export function matchupLoadoutSourceSlug(source: MatchupLoadoutSource): string {
  if (source === 'OP.GG+BZ') return 'opgg-bz'
  return source === 'OP.GG' ? 'opgg' : 'bz'
}

/** 原版位置筛选 → 对位模块统一分路；all/none 不具备可安全合并的分路身份。 */
export function opggPositionToMatchupLane(position: string | null | undefined): LaneName | null {
  switch (position?.toLowerCase()) {
    case 'top':
      return 'top'
    case 'jungle':
      return 'jungle'
    case 'mid':
    case 'middle':
      return 'middle'
    case 'adc':
    case 'bottom':
      return 'bottom'
    case 'support':
    case 'utility':
      return 'utility'
    default:
      return null
  }
}

/** 原版顶部刷新成功后递增；对位部件据此绕过自己的缓存同步刷新。 */
export const matchupRefreshGeneration = shallowRef(0)

export function requestMatchupRefresh() {
  matchupRefreshGeneration.value += 1
}

const MATCHUP_LOADOUT_REQUIRED_SECTIONS = [
  'summoner_spells',
  'runes',
  'starter_items',
  'boots',
  'core_items',
  'last_items'
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveIdArray(value: unknown, expectedLength?: number): value is number[] {
  return (
    Array.isArray(value) &&
    (expectedLength === undefined ? value.length > 0 : value.length === expectedLength) &&
    value.every((id) => typeof id === 'number' && Number.isInteger(id) && id > 0)
  )
}

function hasValidPickStats(row: Record<string, unknown>): boolean {
  return (
    typeof row.play === 'number' &&
    Number.isFinite(row.play) &&
    row.play >= 0 &&
    typeof row.win === 'number' &&
    Number.isFinite(row.win) &&
    row.win >= 0 &&
    row.win <= row.play &&
    typeof row.pick_rate === 'number' &&
    Number.isFinite(row.pick_rate) &&
    row.pick_rate >= 0 &&
    row.pick_rate <= 1
  )
}

function hasValidRows(
  patch: Record<string, unknown>,
  section: string,
  validate: (row: Record<string, unknown>) => boolean
): boolean {
  const rows = patch[section]
  return (
    Array.isArray(rows) && rows.length > 0 && rows.every((row) => isRecord(row) && validate(row))
  )
}

/**
 * 自动写客户端时不做“半套对位 + 半套残留”。缺任一可写区块就整套使用当前通用构筑；
 * UI 仍可诚实展示已有的部分对位数据，手动按钮也只出现在有数据的区块。
 */
export function hasCompleteMatchupLoadout(patch: Record<string, unknown> | null): boolean {
  if (!patch || !MATCHUP_LOADOUT_REQUIRED_SECTIONS.every((section) => section in patch))
    return false

  const spellsValid = hasValidRows(
    patch,
    'summoner_spells',
    (row) => hasValidPickStats(row) && isPositiveIdArray(row.ids, 2) && row.ids[0] !== row.ids[1]
  )
  const runesValid = hasValidRows(
    patch,
    'runes',
    (row) =>
      hasValidPickStats(row) &&
      typeof row.primary_page_id === 'number' &&
      Number.isInteger(row.primary_page_id) &&
      row.primary_page_id > 0 &&
      typeof row.secondary_page_id === 'number' &&
      Number.isInteger(row.secondary_page_id) &&
      row.secondary_page_id > 0 &&
      isPositiveIdArray(row.primary_rune_ids, 4) &&
      isPositiveIdArray(row.secondary_rune_ids, 2) &&
      isPositiveIdArray(row.stat_mod_ids, 3)
  )
  const itemSectionsValid = ['starter_items', 'boots', 'core_items', 'last_items'].every(
    (section) =>
      hasValidRows(patch, section, (row) => hasValidPickStats(row) && isPositiveIdArray(row.ids))
  )

  return spellsValid && runesValid && itemSectionsValid
}

export function setMatchupOverlay(
  patch: Record<string, unknown> | null,
  label = '',
  identity: MatchupOverlayIdentity | null = null,
  meta: MatchupOverlayMeta | null = null,
  loadoutSource: MatchupLoadoutSource = 'OP.GG'
) {
  const nextPatch =
    patch && Object.keys(patch).length > 0
      ? {
          ...patch,
          ...(identity
            ? {
                [MATCHUP_LOADOUT_IDENTITY_KEY]: {
                  opponentChampionId: identity.opponentChampionId,
                  source: loadoutSource
                } satisfies MatchupLoadoutIdentity
              }
            : {})
        }
      : null

  // 多个 ref 不是原子对象：先撤下旧 patch，再切换身份并发布新 patch，避免任何同步
  // 观察者在切换瞬间把“旧 patch + 新 identity”或“新 patch + 旧 identity”拼在一起。
  matchupOverlay.value = null
  matchupOverlayIdentity.value = nextPatch && identity ? { ...identity } : null
  matchupOverlayMeta.value = nextPatch && identity && meta ? { ...meta } : null
  matchupOverlay.value = nextPatch
  matchupOverlayLabel.value = nextPatch ? label : ''
}

export function matchesMatchupOverlayIdentity(
  championId: number,
  identity: MatchupOverlayIdentity | null,
  viewIdentity: MatchupOverlayViewIdentity = {}
): identity is MatchupOverlayIdentity {
  if (!identity || championId !== identity.myChampionId) return false

  const differs = <T>(known: T | null | undefined, actual: T) =>
    known !== undefined && known !== null && known !== actual

  if (viewIdentity.gameId !== undefined && viewIdentity.gameId !== identity.gameId) return false
  if (differs(viewIdentity.opponentChampionId, identity.opponentChampionId)) return false
  // lane=null 表示当前基础详情是 all/none，不是“未知”；此时也必须拒绝合并。
  if (viewIdentity.lane !== undefined && viewIdentity.lane !== identity.lane) return false
  if (differs(viewIdentity.region, identity.region)) return false
  if (
    viewIdentity.tier !== undefined &&
    viewIdentity.tier !== null &&
    String(viewIdentity.tier) !== identity.tier
  ) {
    return false
  }
  // version=null 是“最新补丁”这一明确口径，只有字段完全未提供时才跳过校验。
  if (viewIdentity.version !== undefined && viewIdentity.version !== identity.version) return false
  if (differs(viewIdentity.mode, identity.mode)) return false
  if (differs(viewIdentity.source, identity.source)) return false
  return true
}

export function applyMatchupOverlay<T extends { data: { summary: { id: number } } }>(
  base: T | null,
  patch: Record<string, unknown> | null,
  identity: MatchupOverlayIdentity | null,
  viewIdentity: MatchupOverlayViewIdentity = {}
): T | null {
  if (
    !base ||
    !patch ||
    !matchesMatchupOverlayIdentity(base.data.summary.id, identity, viewIdentity)
  ) {
    return base
  }

  return { ...base, data: { ...base.data, ...patch } } as T
}

export function useMatchupOverlay() {
  return {
    matchupOverlay,
    matchupOverlayLabel,
    matchupOverlayIdentity,
    matchupOverlayMeta,
    matchupRefreshGeneration,
    resolveMatchupLoadoutSource,
    setMatchupOverlay
  }
}
