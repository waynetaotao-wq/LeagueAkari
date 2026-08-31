export type AutoHonorStrategy =
  | 'prefer-lobby-member'
  | 'only-lobby-member'
  | 'all-member'
  | 'opt-out'
  | 'all-member-including-opponent'

export type AutoReportScope = 'opponents-only' | 'all'

/**
 * Riot 客户端当前 LOL 赛后举报弹窗展示的分类。
 *
 * 顺序与客户端保持一致；语音举报项只在开启队伍语音时显示，因此不在自动举报中提供。
 */
export const AUTO_REPORT_CATEGORIES = [
  'LEAVING_AFK',
  'ASSISTING_ENEMY_TEAM',
  'THIRD_PARTY_TOOLS',
  'RANK_MANIPULATION',
  'BOTTING',
  'VERBAL_ABUSE',
  'INAPPROPRIATE_NAME'
] as const

export const AUTO_REPORT_MAX_CATEGORIES = 3

export type AutoReportCategory = (typeof AUTO_REPORT_CATEGORIES)[number]

const AUTO_REPORT_CATEGORY_SET = new Set<string>(AUTO_REPORT_CATEGORIES)

const LEGACY_AUTO_REPORT_CATEGORY_MAP: Record<string, AutoReportCategory> = {
  // 按现行分类描述做兼容迁移，避免升级后直接丢掉用户选择。
  NEGATIVE_ATTITUDE: 'ASSISTING_ENEMY_TEAM',
  HATE_SPEECH: 'VERBAL_ABUSE'
}

export function normalizeAutoReportCategories(value: unknown): AutoReportCategory[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: AutoReportCategory[] = []
  const seen = new Set<AutoReportCategory>()

  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }

    const category =
      LEGACY_AUTO_REPORT_CATEGORY_MAP[item] ??
      (AUTO_REPORT_CATEGORY_SET.has(item) ? (item as AutoReportCategory) : null)

    if (!category || seen.has(category)) {
      continue
    }

    normalized.push(category)
    seen.add(category)

    if (normalized.length === AUTO_REPORT_MAX_CATEGORIES) {
      break
    }
  }

  return normalized
}

export type AutoMatchmakingStrategy = 'never' | 'fixed-duration' | 'estimated-duration'
