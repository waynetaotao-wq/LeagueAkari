/**
 * DraftGap 推荐服务（主进程，挂载于 draftgap-window 命名空间）
 *
 * IPC:
 *   getRecommendations(req) —— 组装实时数据集、运行照抄引擎、附加增强项后返回榜单
 *   getMasteries()          —— 经 LCU 获取本地玩家全英雄熟练度（点数）
 *
 * 增强项（全部为附加信息，不篡改引擎公式）：
 *   - 逐候选拆解：基础 / 我方协同 / 对位，其余并入"阵容背景分"
 *   - 可信度星级：依据样本量（基础场次 + 已知配对平均场次）
 *   - 熟练度加成：基于熟练度点数的温和先验，独立字段返回、封顶 ±6 个
 *     rating 点（约 ±0.86% 胜率），排序可切换，绝不混进"数据胜率"本身
 *   - 阵容体检：我方已锁英雄的物理/魔法伤害占比预警（仅提示，不入分）
 */
import type { AkariIpcMain } from '@main/shards/ipc'
import type { LeagueClientMain } from '@main/shards/league-client'
import type { AkariLogger } from '@main/shards/logger-factory'

import { buildRealtimeDataset } from '@shared/draftgap/realtime-dataset'
import { DEFAULT_TIER, loadChampionIndex } from '@shared/draftgap/realtime-source'
import type { DraftResult } from '@shared/draftgap/vendor/draft/analysis'
import { getSuggestions } from '@shared/draftgap/vendor/draft/suggestions'
import { Role } from '@shared/draftgap/vendor/models/Role'

export interface DraftgapSlot {
  role: Role
  championId: number
}

export interface DraftgapRequest {
  myRole: Role
  allies: DraftgapSlot[]
  enemies: DraftgapSlot[]
  candidateIds: number[]
  tier?: string
}

export interface DraftgapSuggestionDto {
  championId: number
  name: string
  /** 引擎综合胜率（0~1） */
  winrate: number
  totalRating: number
  /** totalRating + (可选)熟练度加成，用于"加权排序" */
  sortRating: number
  masteryRating: number
  masteryPoints: number
  parts: {
    base: number
    allyDuo: number
    matchup: number
    /** 其余队友与敌方整体贡献（对所有候选近似同底色） */
    context: number
  }
  confidence: {
    stars: 1 | 2 | 3
    baseGames: number
    pairGamesAvg: number | null
  }
}

export interface DraftgapResponse {
  ok: boolean
  suggestions: DraftgapSuggestionDto[]
  teamCheck: {
    physicalPct: number | null
    magicPct: number | null
    warnings: string[]
  }
  warnings: string[]
  requested: number
  failed: number
  tier: string
  patch: string
  tookMs: number
  error?: string
}

const ENGINE_CONFIG = {
  ignoreChampionWinrates: false,
  riskLevel: 'medium' as const,
  minGames: 0
}

/** 熟练度点数 → 温和 rating 先验（封顶 6 点 ≈ +0.86% 胜率） */
export function masteryPointsToRating(points: number): number {
  if (!(points > 0)) return 0
  return Math.min(6, 2 * Math.log10(1 + points / 1000))
}

function starsOf(baseGames: number, pairGamesAvg: number | null): 1 | 2 | 3 {
  const basis = pairGamesAvg === null ? baseGames : Math.min(baseGames, pairGamesAvg)
  if (basis >= 3000) return 3
  if (basis >= 800) return 2
  return 1
}

async function fetchMasteries(
  leagueClient: LeagueClientMain,
  logger: AkariLogger
): Promise<Record<number, number>> {
  const lc = leagueClient as any
  const url = '/lol-champion-mastery/v1/local-player/champion-mastery'
  const methods = ['request', 'lcuRequest', 'httpRequest'] as const
  for (const m of methods) {
    if (typeof lc[m] === 'function') {
      try {
        const res = await lc[m]({ method: 'GET', url })
        const data = (res && (res.data ?? res)) as Array<{
          championId: number
          championPoints: number
        }>
        if (Array.isArray(data)) {
          const map: Record<number, number> = {}
          for (const it of data) map[it.championId] = it.championPoints ?? 0
          return map
        }
      } catch (e) {
        logger.warn(`draftgap: 熟练度获取失败(${m}): ${String(e)}`)
        return {}
      }
    }
  }
  logger.warn('draftgap: LeagueClientMain 上未找到可用的请求方法, 熟练度加成停用')
  return {}
}

export function registerDraftgapService(deps: {
  ipc: AkariIpcMain
  namespace: string
  leagueClient: LeagueClientMain
  logger: AkariLogger
}) {
  const { ipc, namespace, leagueClient, logger } = deps

  let masteriesCache: Record<number, number> | null = null

  ipc.onCall(namespace, 'getMasteries', async () => {
    if (!masteriesCache) {
      masteriesCache = await fetchMasteries(leagueClient, logger)
    }
    return masteriesCache
  })

  ipc.onCall(namespace, 'getRecommendations', async (_e, req: DraftgapRequest) => {
    const t0 = Date.now()
    try {
      const tier = req.tier ?? DEFAULT_TIER
      const index = await loadChampionIndex()

      const allies = new Map<Role, string>()
      for (const s of req.allies) allies.set(s.role, String(s.championId))
      const enemies = new Map<Role, string>()
      for (const s of req.enemies) enemies.set(s.role, String(s.championId))

      const candidateKeys = [...new Set(req.candidateIds)].map(String)

      const built = await buildRealtimeDataset({
        myRole: req.myRole,
        allies,
        enemies,
        candidateKeys,
        tier
      })

      if (!masteriesCache) {
        masteriesCache = await fetchMasteries(leagueClient, logger)
      }
      const masteries = masteriesCache

      const candidateSet = new Set(candidateKeys)
      const raw = getSuggestions(
        built.dataset,
        built.fullDataset,
        allies,
        enemies,
        ENGINE_CONFIG
      ).filter((s) => s.role === req.myRole && candidateSet.has(s.championKey))

      const suggestions: DraftgapSuggestionDto[] = raw.map((s) => {
        const dr: DraftResult = s.draftResult
        const key = s.championKey

        const baseRow = dr.allyChampionRating.championResults.find(
          (r) => r.championKey === key && r.role === req.myRole
        )
        const base = baseRow?.rating ?? 0
        const baseGames = baseRow?.games ?? 0

        let allyDuo = 0
        const pairGames: number[] = []
        for (const d of dr.allyDuoRating.duoResults) {
          const mine =
            (d.championKeyA === key && d.roleA === req.myRole) ||
            (d.championKeyB === key && d.roleB === req.myRole)
          if (mine) {
            allyDuo += d.rating
            if (d.games > 0) pairGames.push(d.games)
          }
        }

        let matchup = 0
        for (const m of dr.matchupRating.matchupResults) {
          if (m.championKeyA === key && m.roleA === req.myRole) {
            matchup += m.rating
            if (m.games > 0) pairGames.push(m.games)
          }
        }

        const context = dr.totalRating - base - allyDuo - matchup
        const pairGamesAvg = pairGames.length
          ? pairGames.reduce((a, b) => a + b, 0) / pairGames.length
          : null

        const cid = Number(key)
        const masteryPoints = masteries[cid] ?? 0
        const masteryRating = masteryPointsToRating(masteryPoints)

        return {
          championId: cid,
          name: index.byKey.get(key)?.name ?? `#${key}`,
          winrate: dr.winrate,
          totalRating: dr.totalRating,
          sortRating: dr.totalRating + masteryRating,
          masteryRating,
          masteryPoints,
          parts: { base, allyDuo, matchup, context },
          confidence: {
            stars: starsOf(baseGames, pairGamesAvg),
            baseGames,
            pairGamesAvg
          }
        }
      })

      // —— 阵容体检：我方已锁英雄伤害构成（仅提示，不入分）——
      const teamCheck: DraftgapResponse['teamCheck'] = {
        physicalPct: null,
        magicPct: null,
        warnings: []
      }
      {
        let phys = 0
        let magic = 0
        let tru = 0
        for (const [role, key] of allies) {
          const dp = built.dataset.championData[key]?.statsByRole[role]?.damageProfile
          if (dp) {
            phys += dp.physical
            magic += dp.magic
            tru += dp.true
          }
        }
        const sum = phys + magic + tru
        if (sum > 0 && allies.size >= 2) {
          teamCheck.physicalPct = phys / sum
          teamCheck.magicPct = magic / sum
          if (teamCheck.physicalPct > 0.78) {
            teamCheck.warnings.push(
              `我方已锁阵容物理伤害占比 ${(teamCheck.physicalPct * 100).toFixed(0)}%，易被叠甲针对`
            )
          }
          if (teamCheck.magicPct > 0.78) {
            teamCheck.warnings.push(
              `我方已锁阵容魔法伤害占比 ${(teamCheck.magicPct * 100).toFixed(0)}%，易被叠魔抗针对`
            )
          }
        }
      }

      const resp: DraftgapResponse = {
        ok: true,
        suggestions,
        teamCheck,
        warnings: built.warnings.slice(0, 20),
        requested: built.requested,
        failed: built.failed,
        tier: built.tier,
        patch: built.patch,
        tookMs: Date.now() - t0
      }
      logger.info(
        `draftgap: ${suggestions.length} 候选, 拉取 ${built.requested} 失败 ${built.failed}, ${resp.tookMs}ms`
      )
      return resp
    } catch (e) {
      logger.warn(`draftgap: 推荐计算失败: ${String(e)}`)
      const resp: DraftgapResponse = {
        ok: false,
        suggestions: [],
        teamCheck: { physicalPct: null, magicPct: null, warnings: [] },
        warnings: [],
        requested: 0,
        failed: 0,
        tier: req?.tier ?? DEFAULT_TIER,
        patch: '30',
        tookMs: Date.now() - t0,
        error: String(e)
      }
      return resp
    }
  })

  // 用于换段位/新版本时的缓存主动失效（预留）
  ipc.onCall(namespace, 'resetMasteriesCache', () => {
    masteriesCache = null
  })
}
