/**
 * [lolps] 对局成就：本局 10 人内的"最高 / 最多"与里程碑（WeGame 式小徽章）。
 * 纯函数；与评分无关，只做展示。
 */
import type { AkariScoreInput } from './akari-score'

export type AkariAchievementKey =
  | 'kills'
  | 'damage'
  | 'tank'
  | 'assists'
  | 'cs'
  | 'gold'
  | 'tower'
  | 'vision'
  | 'heal'
  | 'cc'
  | 'kp'
  | 'firstBlood'
  | 'legendary'
  | 'penta'
  | 'quadra'
  | 'triple'
  | 'flawless'

export interface AkariAchievement {
  key: AkariAchievementKey
  /** 单字徽章（无图标环境的回退） */
  glyph: string
  label: string
  /** 徽章配色（Tailwind 类） */
  className: string
  /** 多杀数字角标（五杀 5 / 四杀 4 / 三杀 3） */
  count?: number
}

const DEFS: Record<AkariAchievementKey, Omit<AkariAchievement, 'key'>> = {
  kills: { glyph: '杀', label: '最多击杀', className: 'bg-red-500/25 text-red-200' },
  damage: { glyph: '伤', label: '最高伤害', className: 'bg-orange-500/25 text-orange-200' },
  tank: { glyph: '承', label: '最高承伤', className: 'bg-amber-500/25 text-amber-200' },
  assists: { glyph: '助', label: '最多助攻', className: 'bg-sky-500/25 text-sky-200' },
  cs: { glyph: '兵', label: '最多补兵', className: 'bg-lime-500/25 text-lime-200' },
  gold: { glyph: '金', label: '最高经济', className: 'bg-yellow-500/25 text-yellow-200' },
  tower: { glyph: '塔', label: '最高塔伤', className: 'bg-stone-400/25 text-stone-200' },
  vision: { glyph: '眼', label: '最高视野', className: 'bg-emerald-500/25 text-emerald-200' },
  heal: { glyph: '疗', label: '最高治疗护盾', className: 'bg-pink-500/25 text-pink-200' },
  cc: { glyph: '控', label: '最多控制', className: 'bg-violet-500/25 text-violet-200' },
  kp: { glyph: '团', label: '最高参团', className: 'bg-cyan-500/25 text-cyan-200' },
  firstBlood: { glyph: '血', label: '一血', className: 'bg-rose-500/25 text-rose-200' },
  legendary: { glyph: '神', label: '超神（连杀 ≥ 8）', className: 'bg-fuchsia-500/25 text-fuchsia-200' },
  penta: { glyph: '五', label: '五杀', className: 'bg-yellow-400/30 text-yellow-100', count: 5 },
  quadra: { glyph: '四', label: '四杀', className: 'bg-yellow-400/25 text-yellow-100', count: 4 },
  triple: { glyph: '三', label: '三杀', className: 'bg-yellow-400/20 text-yellow-100', count: 3 },
  flawless: { glyph: '零', label: '零死亡', className: 'bg-teal-500/25 text-teal-200' }
}

/** 徽章顺序：里程碑在前，最值在后 */
const ORDER: AkariAchievementKey[] = [
  'penta', 'quadra', 'triple', 'legendary', 'firstBlood', 'flawless',
  'kills', 'damage', 'tank', 'assists', 'kp', 'cs', 'gold', 'tower', 'vision', 'heal', 'cc'
]

function num(v: unknown) {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

/**
 * 计算每位玩家的成就列表（按 ORDER 排序）。
 * "最高 / 最多"类要求全场唯一最大且大于 0（并列不发，避免一排都是同一徽章）；
 * 击杀需 ≥ 5、助攻需 ≥ 8 才发"最多"，零死亡需对局 ≥ 15 分钟。
 */
export function computeAkariAchievements(
  inputs: AkariScoreInput[],
  gameDurationSeconds: number
): Map<string, AkariAchievement[]> {
  const out = new Map<string, AkariAchievement[]>()
  if (inputs.length < 2) return out
  const teamKills = new Map<string, number>()
  for (const p of inputs) teamKills.set(p.teamIdentifier, (teamKills.get(p.teamIdentifier) ?? 0) + num(p.kills))

  const uniqueMax = (pick: (p: AkariScoreInput) => number, min = 0): string | null => {
    let best = -Infinity
    let who: string | null = null
    let tie = false
    for (const p of inputs) {
      const v = pick(p)
      if (v > best) {
        best = v
        who = p.puuid
        tie = false
      } else if (v === best) tie = true
    }
    return best > min && !tie ? who : null
  }

  const winners: Partial<Record<AkariAchievementKey, string | null>> = {
    kills: uniqueMax((p) => num(p.kills), 4),
    damage: uniqueMax((p) => num(p.totalDamageDealtToChampions)),
    tank: uniqueMax((p) => num(p.totalDamageTaken) + num(p.damageSelfMitigated)),
    assists: uniqueMax((p) => num(p.assists), 7),
    cs: uniqueMax((p) => num(p.cs)),
    gold: uniqueMax((p) => num(p.goldEarned)),
    tower: uniqueMax((p) => num(p.totalDamageToTowers)),
    vision: uniqueMax((p) => num(p.visionScore)),
    heal: uniqueMax((p) => num(p.healsOnTeammates) + num(p.shieldsOnTeammates)),
    cc: uniqueMax((p) => num(p.timeCCingOthers)),
    kp: uniqueMax((p) => {
      const tk = teamKills.get(p.teamIdentifier) ?? 0
      return tk > 0 ? (num(p.kills) + num(p.assists)) / tk : 0
    })
  }

  for (const p of inputs) {
    const keys = new Set<AkariAchievementKey>()
    for (const [key, who] of Object.entries(winners) as Array<[AkariAchievementKey, string | null]>) {
      if (who === p.puuid) keys.add(key)
    }
    if (p.firstBloodKill) keys.add('firstBlood')
    if (num(p.largestKillingSpree) >= 8) keys.add('legendary')
    if (num(p.pentaKills) > 0) keys.add('penta')
    else if (num(p.quadraKills) > 0) keys.add('quadra')
    else if (num(p.tripleKills) > 0) keys.add('triple')
    if (num(p.deaths) === 0 && gameDurationSeconds >= 15 * 60) keys.add('flawless')
    out.set(
      p.puuid,
      ORDER.filter((k) => keys.has(k)).map((k) => ({ key: k, ...DEFS[k] }))
    )
  }
  return out
}
