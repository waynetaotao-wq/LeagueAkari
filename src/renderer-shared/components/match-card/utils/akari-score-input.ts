import type { LcuOrSgpGameSummary } from '@shared/data-adapter/wrapper'
import type { Participant as LcuParticipant } from '@shared/types/league-client/match-history'
import type { SgpParticipantLol } from '@shared/types/sgp/match-history'

import type { AkariScoreInput } from './akari-score'

/** 统一层参与者里评分需要的字段（与 toParticipants 产物的子集结构兼容） */
export interface UnifiedParticipantLike {
  puuid: string
  participantId: number
  teamIdentifier: string
  position: string | null
  win: boolean
  kills: number
  deaths: number
  assists: number
  totalDamageDealtToChampions: number
  totalDamageTaken: number
  goldEarned: number
  cs: number
  neutralMinionsKilled: number
  visionScore: number
  timeCCingOthers: number
  totalDamageToTowers: number
  soloKills: number | null
  doubleKills: number
  tripleKills: number
  quadraKills: number
  pentaKills: number
}

function opt(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function sumOpt(...values: unknown[]): number | null {
  let total = 0
  let any = false
  for (const v of values) {
    const n = opt(v)
    if (n !== null) {
      total += n
      any = true
    }
  }
  return any ? total : null
}

/**
 * [lolps] 把统一层参与者与原始摘要拼接为评分输入。
 * SGP 摘要（国服）字段最全：免伤 / 坐牢时长 / 给队友治疗护盾 / 目标伤害 / 史诗野怪参与 / 对线领先；
 * LCU 摘要只有免伤、目标伤害等基础项，缺失字段留 null，引擎会自动剔除该指标。
 */
export function buildAkariScoreInputs(
  summary: LcuOrSgpGameSummary,
  participants: UnifiedParticipantLike[]
): { inputs: AkariScoreInput[]; earlySurrender: boolean } {
  const base = (p: UnifiedParticipantLike): AkariScoreInput => ({
    puuid: p.puuid,
    teamIdentifier: p.teamIdentifier,
    position: p.position,
    win: p.win,
    kills: p.kills,
    deaths: p.deaths,
    assists: p.assists,
    totalDamageDealtToChampions: p.totalDamageDealtToChampions,
    totalDamageTaken: p.totalDamageTaken,
    goldEarned: p.goldEarned,
    cs: p.cs,
    neutralMinionsKilled: p.neutralMinionsKilled,
    visionScore: p.visionScore,
    timeCCingOthers: p.timeCCingOthers,
    totalDamageToTowers: p.totalDamageToTowers,
    soloKills: p.soloKills,
    doubleKills: p.doubleKills,
    tripleKills: p.tripleKills,
    quadraKills: p.quadraKills,
    pentaKills: p.pentaKills
  })

  let earlySurrender = false

  if (summary.source === 'sgp') {
    const raw = new Map<string, SgpParticipantLol>()
    for (const rp of summary.data.json?.participants ?? []) {
      if (rp?.puuid) raw.set(rp.puuid, rp)
    }
    const inputs = participants.map((p) => {
      const r = raw.get(p.puuid)
      const c = r?.challenges
      if (r?.gameEndedInEarlySurrender) earlySurrender = true
      return {
        ...base(p),
        damageSelfMitigated: opt(r?.damageSelfMitigated),
        totalTimeSpentDead: opt(r?.totalTimeSpentDead),
        healsOnTeammates: opt(r?.totalHealsOnTeammates),
        shieldsOnTeammates: opt(r?.totalDamageShieldedOnTeammates),
        effectiveHealAndShielding: opt(c?.effectiveHealAndShielding),
        damageDealtToObjectives: opt(r?.damageDealtToObjectives),
        epicTakedowns: sumOpt(c?.dragonTakedowns, c?.baronTakedowns, c?.riftHeraldTakedowns),
        maxCsAdvantageOnLaneOpponent: opt(c?.maxCsAdvantageOnLaneOpponent),
        maxLevelLeadLaneOpponent: opt(c?.maxLevelLeadLaneOpponent),
        controlWardsPlaced: opt(c?.controlWardsPlaced),
        wardTakedowns: opt(c?.wardTakedowns),
        immobilizations: opt(c?.enemyChampionImmobilizations),
        turretPlatesTaken: opt(c?.turretPlatesTaken),
        turretTakedowns: opt(r?.turretTakedowns ?? c?.turretTakedowns),
        objectiveSteals: sumOpt(r?.objectivesStolen, c?.epicMonsterSteals),
        hadAfkTeammate: typeof c?.hadAfkTeammate === 'number' ? c.hadAfkTeammate > 0 : null,
        gameEndedInSurrender: r?.gameEndedInSurrender === true
      }
    })
    return { inputs, earlySurrender }
  }

  const raw = new Map<number, LcuParticipant>()
  for (const rp of summary.data.participants ?? []) {
    if (typeof rp?.participantId === 'number') raw.set(rp.participantId, rp)
  }
  const inputs = participants.map((p) => {
    const s = raw.get(p.participantId)?.stats
    if (s?.gameEndedInEarlySurrender) earlySurrender = true
    return {
      ...base(p),
      damageSelfMitigated: opt(s?.damageSelfMitigated),
      damageDealtToObjectives: opt(s?.damageDealtToObjectives),
      // LCU 没有控制守卫"放置"字段，用购买数近似；排眼用 wardsKilled
      controlWardsPlaced: opt(s?.visionWardsBoughtInGame),
      wardTakedowns: opt(s?.wardsKilled),
      turretTakedowns: opt(s?.turretKills),
      gameEndedInSurrender: s?.gameEndedInSurrender === true
    }
  })
  return { inputs, earlySurrender }
}
