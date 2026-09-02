import { describe, expect, it } from 'vitest'

import { type UnifiedParticipantLike, buildAkariScoreInputs } from './akari-score-input'

const unified = (puuid: string, participantId: number): UnifiedParticipantLike => ({
  puuid,
  participantId,
  teamIdentifier: 'TEAM-100',
  position: 'MIDDLE',
  win: true,
  kills: 5,
  deaths: 2,
  assists: 3,
  totalDamageDealtToChampions: 20000,
  totalDamageTaken: 15000,
  goldEarned: 12000,
  cs: 200,
  neutralMinionsKilled: 0,
  visionScore: 20,
  timeCCingOthers: 30,
  totalDamageToTowers: 4000,
  soloKills: 1,
  doubleKills: 0,
  tripleKills: 0,
  quadraKills: 0,
  pentaKills: 0
})

describe('buildAkariScoreInputs', () => {
  it('reads rich fields from an SGP summary (flat + challenges) and flags early surrender', () => {
    const summary = {
      source: 'sgp',
      data: {
        json: {
          participants: [
            {
              puuid: 'a',
              damageSelfMitigated: 9000,
              totalTimeSpentDead: 55,
              totalHealsOnTeammates: 1200,
              totalDamageShieldedOnTeammates: 800,
              damageDealtToObjectives: 15000,
              gameEndedInEarlySurrender: false,
              challenges: {
                effectiveHealAndShielding: 2100,
                dragonTakedowns: 2,
                baronTakedowns: 1,
                riftHeraldTakedowns: 0,
                maxCsAdvantageOnLaneOpponent: 25,
                maxLevelLeadLaneOpponent: 1
              }
            }
          ]
        }
      }
    } as any
    const { inputs, earlySurrender } = buildAkariScoreInputs(summary, [unified('a', 1)])
    expect(earlySurrender).toBe(false)
    expect(inputs[0]).toMatchObject({
      damageSelfMitigated: 9000,
      totalTimeSpentDead: 55,
      healsOnTeammates: 1200,
      shieldsOnTeammates: 800,
      effectiveHealAndShielding: 2100,
      damageDealtToObjectives: 15000,
      epicTakedowns: 3,
      maxCsAdvantageOnLaneOpponent: 25,
      maxLevelLeadLaneOpponent: 1
    })

    summary.data.json.participants[0].gameEndedInEarlySurrender = true
    expect(buildAkariScoreInputs(summary, [unified('a', 1)]).earlySurrender).toBe(true)
  })

  it('reads the LCU subset and leaves SGP-only fields null', () => {
    const summary = {
      source: 'lcu',
      data: {
        participants: [
          {
            participantId: 7,
            stats: { damageSelfMitigated: 4000, damageDealtToObjectives: 9000, gameEndedInEarlySurrender: false }
          }
        ]
      }
    } as any
    const { inputs, earlySurrender } = buildAkariScoreInputs(summary, [unified('x', 7)])
    expect(earlySurrender).toBe(false)
    expect(inputs[0].damageSelfMitigated).toBe(4000)
    expect(inputs[0].damageDealtToObjectives).toBe(9000)
    expect(inputs[0].totalTimeSpentDead).toBeUndefined()
    expect(inputs[0].healsOnTeammates).toBeUndefined()
  })

  it('tolerates missing raw records', () => {
    const summary = { source: 'sgp', data: { json: { participants: [] } } } as any
    const { inputs } = buildAkariScoreInputs(summary, [unified('ghost', 1)])
    expect(inputs[0].puuid).toBe('ghost')
    expect(inputs[0].damageSelfMitigated).toBeNull()
  })
})
