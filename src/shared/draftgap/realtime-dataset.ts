/**
 * DraftGap 实时数据集组装器（我方新写代码，非 vendor）
 *
 * 输入：本局阵容（我方已选、敌方已选、我的候选英雄池、我的位置）
 * 输出：DraftGap 引擎可直接食用的 Dataset（仅填充 championData；
 *       item/rune 等引擎选人评分用不到的字段为空对象）。
 *
 * 取数策略（v1 实时版，o 为一次网络请求）：
 *   - 每个已选英雄（双方共至多 9 个，不含我）：champion o + build-team o
 *       → 提供其基础胜率、其对五路的全量对位表、其与四路的全量协同表
 *   - 我候选池中每个英雄：champion o（lane=我的位置）
 *       → 提供其基础胜率 + 其对五路对位表（候选侧）
 *   - 候选英雄的协同项不单独取其 build-team：由队友侧的协同表单边覆盖。
 *     引擎对协同/对位本就取双向平均，单边缺失时公式自动退化为
 *     "单边胜率、半数样本"，方向正确且收缩机制会恰当地降低其权重。
 *
 * 口径（v1 决策，见 PORTING-NOTES 思路一致性）：
 *   - tier 默认 diamond_plus（钻4~王者，全球，单双排）
 *   - dataset 与 fullDataset 同用 Lolalytics "最近30天" 口径（patch=30）：
 *     样本厚、天然免疫版本初期数据稀薄；"当前小版本鲜度"留给 v2 烘焙版补齐。
 */
import type { Dataset } from './vendor/models/dataset/Dataset'
import type { ChampionData } from './vendor/models/dataset/ChampionData'
import {
  defaultChampionRoleData,
  type ChampionRoleData
} from './vendor/models/dataset/ChampionRoleData'
import { Role, getRoleFromString } from './vendor/models/Role'
import { LOLALYTICS_ROLES, type LolalyticsRole } from './vendor/lolalytics/roles'
import {
  fetchChampionLane,
  fetchTeamSynergy,
  loadChampionIndex,
  THIRTY_DAYS_PATCH,
  DEFAULT_TIER,
  type SourceOptions
} from './realtime-source'

/** 引擎数字角色 → Lolalytics 字符串角色 */
export const ROLE_TO_LOLALYTICS: Record<Role, LolalyticsRole> = {
  [Role.Top]: 'top',
  [Role.Jungle]: 'jungle',
  [Role.Middle]: 'middle',
  [Role.Bottom]: 'bottom',
  [Role.Support]: 'support'
}

/* ---------------- 行解析（6/4 元组自适应） ----------------
 * vendor 类型档案：champion 接口 enemy_* 行按 6 元组解构
 * [championKey, winRate, _, _, _, games]；build-team 的 team 行标注为
 * 4 元组 [championKey, winRate, ?, games]。两处均以行首为数字 key、
 * 次位为百分比胜率；games 取末位健壮兼容两种长度。 */

interface ParsedRow {
  championKey: string
  games: number
  wins: number
}

export function parseStatRow(row: unknown): ParsedRow | null {
  if (!Array.isArray(row) || row.length < 4) return null
  const key = row[0]
  const wr = row[1]
  const games = row.length >= 6 ? row[5] : row[3]
  if (typeof key !== 'number' || typeof wr !== 'number' || typeof games !== 'number') {
    return null
  }
  if (!(games >= 0) || !(wr >= 0 && wr <= 100)) return null
  return { championKey: String(key), games, wins: games * (wr / 100) }
}

/* ---------------- Dataset 骨架与填充 ---------------- */

export function emptyDataset(version: string): Dataset {
  return {
    version,
    date: new Date().toISOString(),
    championData: {},
    itemData: {},
    runeData: {},
    runePathData: {},
    statShardData: {},
    summonerSpellData: {}
  }
}

export function ensureChampion(
  dataset: Dataset,
  key: string,
  meta: { id: string; name: string }
): ChampionData {
  let c = dataset.championData[key]
  if (!c) {
    c = {
      id: meta.id,
      key,
      name: meta.name,
      i18n: {},
      statsByRole: {
        [Role.Top]: defaultChampionRoleData(),
        [Role.Jungle]: defaultChampionRoleData(),
        [Role.Middle]: defaultChampionRoleData(),
        [Role.Bottom]: defaultChampionRoleData(),
        [Role.Support]: defaultChampionRoleData()
      } as ChampionData['statsByRole']
    }
    dataset.championData[key] = c
  }
  return c
}

/** 把 champion 接口响应写入：基础胜率 + 对五路对位表（表主视角） */
export function applyChampionResponse(
  roleData: ChampionRoleData,
  resp: any,
  warnings: string[],
  tag: string
) {
  const n = resp?.header?.n
  const wr = resp?.header?.wr
  if (typeof n === 'number' && typeof wr === 'number' && n >= 0) {
    roleData.games = n
    roleData.wins = Math.round((n * wr) / 100)
  } else {
    warnings.push(`${tag}: header.n/wr 缺失，基础胜率置零`)
  }
  const damage = resp?.header?.damage
  if (
    damage &&
    typeof damage.physical === 'number' &&
    typeof damage.magic === 'number' &&
    typeof damage.true === 'number'
  ) {
    roleData.damageProfile = {
      physical: damage.physical,
      magic: damage.magic,
      true: damage.true
    }
  }
  for (const enemyRole of LOLALYTICS_ROLES) {
    const rows = resp?.enemy?.[enemyRole] ?? resp?.[`enemy_${enemyRole}`]
    if (!Array.isArray(rows)) {
      warnings.push(`${tag}: enemy_${enemyRole} 缺失`)
      continue
    }
    const table = roleData.matchup[getRoleFromString(enemyRole)]
    for (const raw of rows) {
      const row = parseStatRow(raw)
      if (!row) continue
      table[row.championKey] = {
        championKey: row.championKey,
        games: row.games,
        wins: row.wins
      }
    }
  }
}

/** 把 build-team 接口响应写入：与四个友方位置的协同表（表主视角） */
export function applyTeamResponse(
  roleData: ChampionRoleData,
  ownRole: LolalyticsRole,
  resp: any,
  warnings: string[],
  tag: string
) {
  for (const allyRole of LOLALYTICS_ROLES) {
    if (allyRole === ownRole) continue
    const rows = resp?.team?.[allyRole] ?? resp?.[`team_${allyRole}`]
    if (!Array.isArray(rows)) {
      warnings.push(`${tag}: team ${allyRole} 缺失`)
      continue
    }
    const table = roleData.synergy[getRoleFromString(allyRole)]
    for (const raw of rows) {
      const row = parseStatRow(raw)
      if (!row) continue
      table[row.championKey] = {
        championKey: row.championKey,
        games: row.games,
        wins: row.wins
      }
    }
  }
}

/* ---------------- 对外主函数 ---------------- */

export interface RealtimeDraftInput {
  /** 我的位置 */
  myRole: Role
  /** 我方已选（不含我未锁定的候选）：位置 → Riot 数字 key 字符串 */
  allies: Map<Role, string>
  /** 敌方已选：位置 → Riot 数字 key 字符串 */
  enemies: Map<Role, string>
  /** 我的候选英雄池（Riot 数字 key 字符串数组） */
  candidateKeys: string[]
  tier?: string
  /** 默认 "30"（最近30天） */
  patch?: string
}

export interface RealtimeDatasetResult {
  dataset: Dataset
  /** v1 与 dataset 同引用（见文件头口径说明） */
  fullDataset: Dataset
  warnings: string[]
  requested: number
  failed: number
  tier: string
  patch: string
}

export async function buildRealtimeDataset(
  input: RealtimeDraftInput
): Promise<RealtimeDatasetResult> {
  const tier = input.tier ?? DEFAULT_TIER
  const patch = input.patch ?? THIRTY_DAYS_PATCH
  const opts: SourceOptions = { tier, patch }
  const warnings: string[] = []

  const index = await loadChampionIndex()
  const dataset = emptyDataset(`realtime-${patch}-${tier}`)

  const metaOf = (key: string) =>
    index.byKey.get(key) ?? { id: `Key${key}`, key, name: `#${key}` }

  type Job = { run: () => Promise<void>; tag: string }
  const jobs: Job[] = []

  const picked: Array<{ role: Role; key: string }> = []
  for (const [role, key] of input.allies) picked.push({ role, key })
  for (const [role, key] of input.enemies) picked.push({ role, key })

  // —— 已选英雄：champion + build-team 双接口 ——
  for (const { role, key } of picked) {
    const meta = metaOf(key)
    const lane = ROLE_TO_LOLALYTICS[role]
    const roleData = () => ensureChampion(dataset, key, meta).statsByRole[role]
    jobs.push({
      tag: `${meta.id}@${lane}/champion`,
      run: async () => {
        const resp = await fetchChampionLane({ key, id: meta.id }, lane, opts)
        applyChampionResponse(roleData(), resp, warnings, `${meta.id}@${lane}`)
      }
    })
    jobs.push({
      tag: `${meta.id}@${lane}/team`,
      run: async () => {
        const resp = await fetchTeamSynergy(meta.id, lane, opts)
        applyTeamResponse(roleData(), lane, resp, warnings, `${meta.id}@${lane}`)
      }
    })
  }

  // —— 候选池：仅 champion 接口（协同由队友侧单边覆盖） ——
  const pickedKeys = new Set(picked.map((p) => p.key))
  const myLane = ROLE_TO_LOLALYTICS[input.myRole]
  for (const key of input.candidateKeys) {
    if (pickedKeys.has(key)) continue
    const meta = metaOf(key)
    jobs.push({
      tag: `${meta.id}@${myLane}/champion`,
      run: async () => {
        const resp = await fetchChampionLane({ key, id: meta.id }, myLane, opts)
        applyChampionResponse(
          ensureChampion(dataset, key, meta).statsByRole[input.myRole],
          resp,
          warnings,
          `${meta.id}@${myLane}`
        )
      }
    })
  }

  const results = await Promise.allSettled(jobs.map((j) => j.run()))
  let failed = 0
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      failed++
      warnings.push(`${jobs[i].tag}: 拉取失败 ${String(r.reason)}`)
    }
  })

  return {
    dataset,
    fullDataset: dataset,
    warnings,
    requested: jobs.length,
    failed,
    tier,
    patch
  }
}
