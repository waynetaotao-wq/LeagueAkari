import type {
  OpggBuildPickItem,
  OpggRuneBuild,
  OpggSkillKey,
  OpggSkillMastery
} from '@shared/types/opgg'

/**
 * [lolps] OP.GG 对位构筑：官方 target_champion JSON → 原版 UI 数据形状。
 *
 * OP.GG 的 champion JSON 现已支持 target_champion。与旧网页 HTML 解析相比，
 * 该通道会一次返回召唤师、符文页、技能加点、前期构筑与后续装备持有汇总，
 * 并保留重复消耗品数量。
 * 本模块只做两件纯逻辑工作：把页面口径的聚合数据转成原版组件需要的形状，
 * 以及在提交 overlay 前检查样本是否仍像“指定对手”而非误回的通用大样本。
 */

export const MATCHUP_SECTION_KEYS = [
  'summoner_spells',
  'runes',
  'skill_masteries',
  'starter_items',
  'boots',
  'core_items',
  'last_items'
] as const

export type MatchupSectionKey = (typeof MATCHUP_SECTION_KEYS)[number]

export interface MatchupOverlayData {
  summoner_spells: OpggBuildPickItem[]
  runes: OpggRuneBuild[]
  skill_masteries: OpggSkillMastery[]
  starter_items: OpggBuildPickItem[]
  boots: OpggBuildPickItem[]
  core_items: OpggBuildPickItem[]
  last_items: Array<OpggBuildPickItem & { is_matchup_aggregate: true }>
  /** 排位对位不应继承斗魂棱彩装备；防御性显式清空，但不计入七个统计区块。 */
  prism_items: OpggBuildPickItem[]
}

export interface MatchupOverlayBuildResult {
  overlay: MatchupOverlayData
  parsedSections: MatchupSectionKey[]
}

type UnknownRecord = Record<string, unknown>

type ValidStats = UnknownRecord & {
  play: number
  win: number
  pick_rate: number
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readField(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined
}

function readArrayField(value: unknown, key: string): unknown[] {
  const field = readField(value, key)
  return Array.isArray(field) ? field : []
}

function hasValidStats(row: unknown): row is ValidStats {
  if (!isRecord(row)) return false
  return (
    typeof row.play === 'number' &&
    Number.isFinite(row.play) &&
    row.play > 0 &&
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

function copyPositiveIds(
  value: unknown,
  { expectedLength, allowEmpty = false }: { expectedLength?: number; allowEmpty?: boolean } = {}
): number[] | null {
  if (!Array.isArray(value)) return null
  if (expectedLength !== undefined && value.length !== expectedLength) return null
  if (!allowEmpty && value.length === 0) return null
  const ids: number[] = []
  for (const id of value) {
    if (!isPositiveInteger(id)) return null
    ids.push(id)
  }
  return ids
}

function copySkillKeys(value: unknown, allowEmpty = false): OpggSkillKey[] | null {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) return null
  const skills: OpggSkillKey[] = []
  for (const skill of value) {
    if (typeof skill !== 'string' || !/^(?:[QWER]|R-[QWER])$/.test(skill)) return null
    skills.push(skill as OpggSkillKey)
  }
  return skills
}

function copyOptionalStat(row: UnknownRecord, key: 'total_place' | 'first_place') {
  const value = row[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function copyPickRows(rows: unknown, allowEmptyIds = false): OpggBuildPickItem[] {
  if (!Array.isArray(rows)) return []
  return rows.flatMap((row) => {
    if (!hasValidStats(row)) return []
    // OP.GG 的真实 skill_masteries[].builds[] 没有 ids 字段；仅该调用场景允许缺省并补 []。
    const ids =
      allowEmptyIds && row.ids === undefined
        ? []
        : copyPositiveIds(row.ids, { allowEmpty: allowEmptyIds })
    if (!ids) return []

    const order = copySkillKeys(row.order, true)
    const totalPlace = copyOptionalStat(row, 'total_place')
    const firstPlace = copyOptionalStat(row, 'first_place')
    return [
      {
        ids,
        play: row.play,
        win: row.win,
        pick_rate: row.pick_rate,
        ...(order && order.length > 0 ? { order } : {}),
        ...(totalPlace !== undefined ? { total_place: totalPlace } : {}),
        ...(firstPlace !== undefined ? { first_place: firstPlace } : {})
      }
    ]
  })
}

/**
 * 网页“符文”卡按 rune_pages 展示：外层是整套系的场次/胜率/选取率，
 * builds[0] 才是要应用的完整六颗符文与三颗碎片。直接使用 data.runes 会把
 * 同一符文页拆成多行细分，数字便无法与网页主卡对应。
 */
function copyRuneBuild(row: unknown): OpggRuneBuild | null {
  if (!hasValidStats(row)) return null
  const id = row.id
  const primaryPageId = row.primary_page_id
  const secondaryPageId = row.secondary_page_id
  const primaryRuneIds = copyPositiveIds(row.primary_rune_ids, { expectedLength: 4 })
  const secondaryRuneIds = copyPositiveIds(row.secondary_rune_ids, { expectedLength: 2 })
  const statModIds = copyPositiveIds(row.stat_mod_ids, { expectedLength: 3 })
  if (
    !isPositiveInteger(id) ||
    !isPositiveInteger(primaryPageId) ||
    !isPositiveInteger(secondaryPageId) ||
    !primaryRuneIds ||
    !secondaryRuneIds ||
    !statModIds
  ) {
    return null
  }

  return {
    id,
    primary_page_id: primaryPageId,
    primary_rune_ids: primaryRuneIds,
    secondary_page_id: secondaryPageId,
    secondary_rune_ids: secondaryRuneIds,
    stat_mod_ids: statModIds,
    play: row.play,
    win: row.win,
    pick_rate: row.pick_rate
  }
}

function buildRuneRows(data: unknown): OpggRuneBuild[] {
  const pages = readArrayField(data, 'rune_pages')
  const fromPages = pages.flatMap((page) => {
    if (!hasValidStats(page)) return []
    const build = readArrayField(page, 'builds')
      .map(copyRuneBuild)
      .find((candidate): candidate is OpggRuneBuild => candidate !== null)
    if (!build) return []
    const pageId = isPositiveInteger(page.id) ? page.id : build.id
    return [
      {
        id: pageId,
        primary_page_id: build.primary_page_id,
        primary_rune_ids: [...build.primary_rune_ids],
        secondary_page_id: build.secondary_page_id,
        secondary_rune_ids: [...build.secondary_rune_ids],
        stat_mod_ids: [...build.stat_mod_ids],
        play: page.play,
        win: page.win,
        pick_rate: page.pick_rate
      }
    ]
  })
  if (fromPages.length > 0) return fromPages

  return readArrayField(data, 'runes').flatMap((rune) => {
    const copied = copyRuneBuild(rune)
    return copied ? [copied] : []
  })
}

/**
 * 原版技能组件显示 mastery.ids + mastery.builds[0].order，并把 mastery 自身统计
 * 放在右侧。OP.GG 网页右侧数字属于首条具体加点顺序，因此同步到外层，避免显示
 * “Q>E>W 全部方案”的汇总数字却配“第一条顺序”的图形。
 */
function buildSkillRows(data: unknown): OpggSkillMastery[] {
  return readArrayField(data, 'skill_masteries').flatMap((mastery) => {
    if (!isRecord(mastery)) return []
    const ids = copySkillKeys(mastery.ids)
    if (!ids) return []
    const builds = copyPickRows(mastery.builds, true).filter(
      (build) => Array.isArray(build.order) && build.order.length > 0
    )
    const first = builds[0]
    if (!first) return []
    return [
      {
        ids,
        play: first.play,
        win: first.win,
        pick_rate: first.pick_rate,
        builds
      }
    ]
  })
}

/** 所有七个键都显式写入；缺项用 [] 清空，绝不保留通用构筑冒充对位数据。 */
export function buildMatchupOverlay(data: unknown): MatchupOverlayBuildResult {
  const overlay: MatchupOverlayData = {
    summoner_spells: copyPickRows(readField(data, 'summoner_spells')).filter(
      (row) => row.ids.length === 2 && row.ids[0] !== row.ids[1]
    ),
    runes: buildRuneRows(data),
    skill_masteries: buildSkillRows(data),
    starter_items: copyPickRows(readField(data, 'starter_items')),
    boots: copyPickRows(readField(data, 'boots')),
    core_items: copyPickRows(readField(data, 'core_items')),
    // JSON 的 last_items 是“后续装备持有汇总”，并非网页 Fourth/Fifth Item 分槽。
    last_items: copyPickRows(readField(data, 'last_items')).map((row) => ({
      ...row,
      is_matchup_aggregate: true as const
    })),
    prism_items: []
  }

  const parsedSections = MATCHUP_SECTION_KEYS.filter((key) => overlay[key].length > 0)
  return { overlay, parsedSections }
}

/**
 * target_champion 没有响应回显字段，因此必须与同口径、未带 target 的基线响应做实证对照。
 * 目标区块的估算 cohort 必须贴近对位场次并显著小于通用基线；这样两份缓存仅相差
 * 1–2 场时不会被误当成 target 参数生效。
 */
export function isTargetSpecificMatchupBuild(
  targetData: unknown,
  genericData: unknown,
  matchupGames: number
): boolean {
  return (
    buildVerifiedMatchupOverlay(targetData, genericData, matchupGames).parsedSections.length >= 2
  )
}

/**
 * 逐区与无 target 基线对照：相同或无法比较的区块显式清空，绝不因另外两区通过就把
 * 其余通用数据一起下发。整体调用方仍应要求至少两个 verified sections。
 */
export function buildVerifiedMatchupOverlay(
  targetData: unknown,
  genericData: unknown,
  matchupGames: number
): MatchupOverlayBuildResult {
  const target = buildMatchupOverlay(targetData)
  const generic = buildMatchupOverlay(genericData)
  const overlay: MatchupOverlayData = {
    ...target.overlay,
    summoner_spells: [],
    runes: [],
    skill_masteries: [],
    starter_items: [],
    boots: [],
    core_items: [],
    last_items: [],
    prism_items: []
  }
  const parsedSections: MatchupSectionKey[] = []
  for (const key of MATCHUP_SECTION_KEYS) {
    const targetCohort = estimateSectionCohort(targetData, target.overlay, key)
    const genericCohort = estimateSectionCohort(genericData, generic.overlay, key)
    if (
      target.overlay[key].length > 0 &&
      generic.overlay[key].length > 0 &&
      targetCohort !== null &&
      genericCohort !== null &&
      isCohortAlignedWithMatchup(targetCohort, matchupGames) &&
      hasMeaningfulCohortReduction(targetCohort, genericCohort, matchupGames)
    ) {
      overlay[key] = target.overlay[key] as never
      parsedSections.push(key)
    }
  }
  return { overlay, parsedSections }
}

function estimateCohort(rows: unknown): number | null {
  if (!Array.isArray(rows)) return null
  let plays = 0
  let pickRate = 0
  for (const row of rows) {
    if (!hasValidStats(row) || row.pick_rate <= 0) continue
    plays += row.play
    pickRate += row.pick_rate
  }
  return plays > 0 && pickRate > 0 ? plays / pickRate : null
}

function estimateSectionCohort(
  data: unknown,
  overlay: MatchupOverlayData,
  key: MatchupSectionKey
): number | null {
  if (key !== 'skill_masteries') return estimateCohort(overlay[key])

  // 技能 UI 显示首条具体加点 build 的统计，但不同 mastery 的 build.pick_rate 分母不同；
  // target 证明必须回到最终可解析 mastery 的外层统计，才能正确估算共同样本母体。
  const parseableMasteries = readArrayField(data, 'skill_masteries').filter(
    (mastery) => buildSkillRows({ skill_masteries: [mastery] }).length > 0
  )
  return estimateCohort(parseableMasteries)
}

/** 允许各卡片统计条件不同，但估算样本母体不能远离同一对位的 counters 场次。 */
function isCohortAlignedWithMatchup(cohort: number, matchupGames: number): boolean {
  if (!Number.isFinite(cohort) || !Number.isFinite(matchupGames) || matchupGames <= 0) return false
  return cohort >= Math.max(1, matchupGames * 0.25) && cohort <= matchupGames * 2.5 + 10
}

/**
 * target cohort 至少比通用 cohort 缩小一半，且绝对差不只是缓存轮转的几场漂移。
 * 这是 fail-closed 规则：极端高占比对位宁可回退，也不把通用构筑冒充对位。
 */
function hasMeaningfulCohortReduction(
  targetCohort: number,
  genericCohort: number,
  matchupGames: number
): boolean {
  return (
    targetCohort <= genericCohort * 0.5 &&
    genericCohort - targetCohort >= Math.max(10, matchupGames * 0.5)
  )
}

/** 无锚点验证的最小样本：低于此值的冷门对位数据噪声过大，宁可回通用 */
export const MIN_UNANCHORED_MATCHUP_GAMES = 5

export interface UnanchoredMatchupEstimate {
  /** 由 target 各区块母体取中位数得到的对位场次估计 */
  games: number
  /** 由召唤师技能区块行统计汇总的对位胜负（各行按技能组合划分整个母体） */
  meta: { play: number; win: number } | null
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/**
 * 对手不在 counters 列表时的替代验证（OP.GG 的 counters 只收前 60 个对手，
 * 冷门对位天然没有锚点）。证明 target_champion 确实生效的依据改为：
 * ① target 至少两个区块能估算母体，且彼此对齐（同一小样本）；
 * ② 这些母体相对通用母体显著缩小（服务端若忽略 target，母体会与通用几乎相同）。
 * 满足则返回估计场次与由召唤师技能区块汇总的胜负；否则 null（调用方 fail closed）。
 */
export function estimateUnanchoredMatchup(
  targetData: unknown,
  genericData: unknown
): UnanchoredMatchupEstimate | null {
  const target = buildMatchupOverlay(targetData)
  const generic = buildMatchupOverlay(genericData)
  const cohorts: number[] = []
  const genericCohorts: number[] = []
  for (const key of MATCHUP_SECTION_KEYS) {
    const t = estimateSectionCohort(targetData, target.overlay, key)
    const g = estimateSectionCohort(genericData, generic.overlay, key)
    if (t !== null && g !== null) {
      cohorts.push(t)
      genericCohorts.push(g)
    }
  }
  if (cohorts.length < 2) return null
  const games = median(cohorts)
  if (!Number.isFinite(games) || games < MIN_UNANCHORED_MATCHUP_GAMES) return null
  // 至少两个区块与中位数对齐，且各自相对通用显著缩小
  let verified = 0
  for (let index = 0; index < cohorts.length; index++) {
    if (
      isCohortAlignedWithMatchup(cohorts[index], games) &&
      hasMeaningfulCohortReduction(cohorts[index], genericCohorts[index], games)
    ) {
      verified++
    }
  }
  if (verified < 2) return null

  let play = 0
  let win = 0
  for (const row of target.overlay.summoner_spells) {
    if (!hasValidStats(row)) continue
    play += row.play
    win += row.win
  }
  const meta = play > 0 && win >= 0 && win <= play ? { play, win } : null
  return { games, meta }
}

/** 两个并行响应的 counters 锚点必须仍属同一统计快照；漂移过大时整次 fail closed。 */
export function resolveComparableMatchupGames(
  targetGames: number,
  genericGames: number
): number | null {
  if (
    !Number.isFinite(targetGames) ||
    !Number.isFinite(genericGames) ||
    targetGames <= 0 ||
    genericGames <= 0
  ) {
    return null
  }
  const maximum = Math.max(targetGames, genericGames)
  if (Math.abs(targetGames - genericGames) > Math.max(5, maximum * 0.1)) return null
  return (targetGames + genericGames) / 2
}

/**
 * target_champion 不是公开稳定契约；若服务端以后忽略它，HTTP 仍可能 200，但构筑
 * 会退成数千场通用数据。对位 counters 的 play 是独立且可信的同场样本锚点：
 * 各构筑区首行允许因统计条件不同而有宽松差异，却不应大出几十/几百倍。
 */
export function isPlausibleMatchupBuild(data: unknown, matchupGames: number): boolean {
  if (!Number.isFinite(matchupGames) || matchupGames <= 0) return false

  const built = buildMatchupOverlay(data)
  const observed = MATCHUP_SECTION_KEYS.map((key) =>
    estimateSectionCohort(data, built.overlay, key)
  ).filter((games): games is number => games !== null)

  // 单一区块不足以证明服务端确实应用了 target_champion，宁可诚实回退。
  if (observed.length < 2) return false

  return observed.filter((games) => isCohortAlignedWithMatchup(games, matchupGames)).length >= 2
}
