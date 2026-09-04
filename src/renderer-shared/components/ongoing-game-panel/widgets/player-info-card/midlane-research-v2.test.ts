import { describe, expect, it } from 'vitest'

import {
  type MidLiteGame,
  analyzeDeep,
  analyzeOneTimeline,
  analyzeOneTimelineV2,
  classifyLaneCorridor,
  collectVersionLadder,
  extractMidLite
} from './midlane-research'

const SELF = 3
const ENEMY_MID = 8
const TEAMS = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [i + 1, i < 5 ? 100 : 200]))
function frame(
  minute: number,
  selfPos: { x: number; y: number },
  extra: Partial<any> = {},
  events: any[] = []
) {
  return {
    timestamp: minute * 60_000,
    participantFrames: {
      [SELF]: {
        position: selfPos,
        level: 5,
        minionsKilled: 8 * minute,
        jungleMinionsKilled: 0,
        totalGold: 500 + 400 * minute,
        ...extra
      },
      [ENEMY_MID]: {
        position: { x: 7500, y: 7500 },
        minionsKilled: 7 * minute,
        jungleMinionsKilled: 0,
        totalGold: 500 + 350 * minute
      }
    },
    events
  }
}
const MID = { x: 7400, y: 7400 }
const RIVER_WARD = { x: 9300, y: 4300 } // 河道/龙坑附近：不是走廊，不算游走
const BOT_LANE = { x: 12000, y: 2500 } // 下路走廊
const TOP_LANE = { x: 2500, y: 12000 } // 上路走廊

describe('midlane research v2', () => {
  it('classifies only true lane corridors as roam destinations', () => {
    expect(classifyLaneCorridor(BOT_LANE.x, BOT_LANE.y)).toBe('bot')
    expect(classifyLaneCorridor(TOP_LANE.x, TOP_LANE.y)).toBe('top')
    expect(classifyLaneCorridor(RIVER_WARD.x, RIVER_WARD.y)).toBeNull()
    expect(classifyLaneCorridor(MID.x, MID.y)).toBeNull()
  })

  it('merges consecutive corridor frames into one episode, marks kills as success, ignores river trips', () => {
    const frames = [
      frame(0, MID),
      frame(1, MID),
      frame(2, MID),
      frame(3, RIVER_WARD), // 插眼：不算游走
      frame(4, MID),
      frame(5, BOT_LANE),
      frame(6, BOT_LANE, {}, [
        {
          type: 'CHAMPION_KILL',
          timestamp: 6 * 60_000 + 20_000,
          killerId: SELF,
          victimId: 9,
          assistingParticipantIds: [4],
          position: { x: 11800, y: 2600 }
        }
      ]),
      frame(7, MID),
      frame(8, MID),
      frame(9, MID),
      frame(10, MID),
      frame(11, TOP_LANE),
      frame(12, MID),
      frame(13, MID),
      frame(14, MID)
    ]
    const r = analyzeOneTimelineV2({ frames }, SELF, 100, ENEMY_MID, TEAMS)
    expect(r.roamEpisodes.length).toBe(2)
    expect(r.roamEpisodes[0]).toMatchObject({ dir: 'bot', success: true, startMs: 5 * 60_000 })
    expect(r.roamEpisodes[1]).toMatchObject({ dir: 'top', success: false })
    expect(r.zoneFrames.mid).toBeGreaterThan(r.zoneFrames.top)
    expect(r.minutePositions.length).toBe(13) // 2..14 分钟
    expect(r.killPoints.length).toBe(1)
    expect(r.earlyTakedowns).toBe(1)
    expect(r.earlyTeamKills).toBe(1)
  })

  it('computes lane diff at 10:00 against the enemy mid and counts solo kills / mid solo deaths only', () => {
    const frames = Array.from({ length: 15 }, (_, m) => frame(m, MID))
    frames[7].events = [
      {
        type: 'CHAMPION_KILL',
        timestamp: 7 * 60_000,
        killerId: SELF,
        victimId: ENEMY_MID,
        assistingParticipantIds: [],
        position: { x: 7300, y: 7500 }
      },
      {
        type: 'CHAMPION_KILL',
        timestamp: 7 * 60_000 + 30_000,
        killerId: ENEMY_MID,
        victimId: SELF,
        assistingParticipantIds: [],
        position: { x: 7400, y: 7300 }
      },
      // 在下路被单杀：属于游走被反，不计入"被单杀（对线）"
      {
        type: 'CHAMPION_KILL',
        timestamp: 7 * 60_000 + 50_000,
        killerId: 9,
        victimId: SELF,
        assistingParticipantIds: [],
        position: { x: 12000, y: 2500 }
      }
    ]
    const r = analyzeOneTimelineV2({ frames }, SELF, 100, ENEMY_MID, TEAMS)
    expect(r.laneDiff10).toEqual({ cs: 10, gold: 500 })
    expect(r.soloKills).toBe(1)
    expect(r.soloDeaths).toBe(1)
  })

  it('returns no lane diff when the enemy mid is unknown', () => {
    const frames = Array.from({ length: 12 }, (_, m) => frame(m, MID))
    const r = analyzeOneTimelineV2({ frames }, SELF, 100, null, TEAMS)
    expect(r.laneDiff10).toBeNull()
  })
})

function summary() {
  return {
    gameId: 1,
    gameVersion: '16.17.1',
    gameCreation: 1_700_000_000_000,
    gameDuration: 1800,
    gameMode: 'CLASSIC',
    mapId: 11,
    queueId: 420,
    endOfGameResult: 'GameComplete',
    participants: Array.from({ length: 10 }, (_, i) => ({
      participantId: i + 1,
      puuid: i + 1 === SELF ? 'p' : `other-${i}`,
      championId: i + 1 === SELF ? 238 : 1,
      teamId: i < 5 ? 100 : 200,
      teamPosition: ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY'][i % 5],
      win: i < 5,
      gameEndedInEarlySurrender: false
    }))
  }
}

function liteGame(gameId: number): MidLiteGame {
  return {
    gameId,
    gameVersion: '16.17',
    gameCreation: 1_700_000_000_000 - gameId,
    gameDuration: 1800,
    win: true,
    selfPid: SELF,
    teamId: 100,
    enemyMidPid: ENEMY_MID,
    participantTeams: TEAMS
  }
}

function validTimeline() {
  return { frames: Array.from({ length: 15 }, (_, m) => frame(m, m === 5 ? BOT_LANE : MID)) }
}

function kill(timestamp: number, extra: Record<string, unknown> = {}) {
  return {
    type: 'CHAMPION_KILL',
    timestamp,
    killerId: SELF,
    victimId: ENEMY_MID,
    assistingParticipantIds: [],
    position: MID,
    ...extra
  }
}

describe('midlane research accuracy and missing-data contracts', () => {
  it('collects only this champion in mid in complete non-remake 5v5 matches', () => {
    const accepted = extractMidLite(summary(), 'p', 238)
    expect(accepted?.enemyMidPid).toBe(ENEMY_MID)
    expect(accepted?.participantTeams).toEqual(TEAMS)
    for (const position of ['TOP', 'JUNGLE', 'BOTTOM', 'UTILITY', '']) {
      const input = summary()
      input.participants[SELF - 1].teamPosition = position
      expect(extractMidLite(input, 'p', 238)).toBeNull()
    }
    const remake = summary()
    remake.participants[0].gameEndedInEarlySurrender = true
    const missingPlayer = summary()
    missingPlayer.participants.pop()
    const duplicateId = summary()
    duplicateId.participants[0].participantId = SELF
    for (const input of [
      remake,
      missingPlayer,
      duplicateId,
      { ...summary(), gameDuration: 180 },
      { ...summary(), endOfGameResult: 'Abort_TooFewPlayers' },
      { ...summary(), mapId: 12 }
    ]) {
      expect(extractMidLite(input, 'p', 238)).toBeNull()
    }
  })

  it('does not present list errors or malformed responses as a player with no history', async () => {
    await expect(
      collectVersionLadder(
        async () => {
          throw new Error('network unavailable')
        },
        'p',
        238
      )
    ).rejects.toThrow('network unavailable')
    await expect(collectVersionLadder(async () => ({}) as any, 'p', 238)).rejects.toThrow(
      '格式异常'
    )
    expect((await collectVersionLadder(async () => ({ games: [] }), 'p', 238)).games).toEqual([])
  })

  it('counts only valid complete timelines in rates and retains failure counts', async () => {
    const partial = validTimeline()
    partial.frames = partial.frames.slice(0, 4)
    const result = await analyzeDeep([1, 2, 3, 4].map(liteGame), async (id) => {
      if (id === 2) throw new Error('timeline unavailable')
      if (id === 3) return { frames: [] }
      if (id === 4) return partial
      return validTimeline()
    })
    expect(result.attemptedGames).toBe(4)
    expect(result.deepGames).toBe(1)
    expect(result.timelineFailures).toBe(3)
    expect(result.roamFirstTimesMs.length / result.deepGames).toBe(1)
    const unavailable = await analyzeDeep([liteGame(1)], async () => ({ frames: [] }))
    expect(unavailable.deepGames).toBe(0)
    expect(unavailable.attemptedGames).toBe(1)
    expect(unavailable.timelineFailures).toBe(1)
  })

  it('rejects a full timestamp series when player positions are missing instead of inferring zero roaming', async () => {
    const incomplete = validTimeline()
    for (let minute = 0; minute < incomplete.frames.length; minute++) {
      if (minute !== 2) delete (incomplete.frames[minute].participantFrames[SELF] as any).position
    }
    const result = await analyzeDeep([liteGame(1)], async () => incomplete)
    expect(result.attemptedGames).toBe(1)
    expect(result.deepGames).toBe(0)
    expect(result.timelineFailures).toBe(1)
    expect(result.minutePositions.length).toBe(0)
    expect(result.roamFirstTimesMs.length).toBe(0)
  })

  it('uses exact level-up events before the first early solo kill, excluding XP gained after that kill', () => {
    const before = kill(335_000)
    const frames = [
      frame(5, MID, { level: 5 }),
      frame(6, MID, { level: 6 }, [
        { type: 'LEVEL_UP', timestamp: 330_000, participantId: SELF, level: 6 },
        before
      ])
    ]
    expect(analyzeOneTimeline({ frames }, SELF, 100).firstSoloKill).toEqual({ level: 6 })
    frames[1].events = [
      kill(335_000),
      { type: 'LEVEL_UP', timestamp: 335_000, participantId: SELF, level: 6 }
    ]
    expect(analyzeOneTimeline({ frames }, SELF, 100).firstSoloKill).toEqual({ level: 5 })
    frames[1].events = [kill(29 * 60_000)]
    expect(analyzeOneTimeline({ frames }, SELF, 100).firstSoloKill).toBeNull()
  })

  it('does not invent a level when no level snapshot or level-up is available', () => {
    const frames = [frame(5, MID, { level: undefined }, [kill(310_000)])]
    expect(analyzeOneTimeline({ frames }, SELF, 100).firstSoloKill).toEqual({ level: null })
  })

  it('merges adjacent corridor frames with timestamp drift but excludes frames after 14 minutes', () => {
    const frames = [300_010, 360_030, 420_050, 850_000].map((ms) => ({
      ...frame(0, BOT_LANE),
      timestamp: ms
    }))
    const result = analyzeOneTimelineV2({ frames }, SELF, 100, ENEMY_MID, TEAMS)
    expect(result.roamEpisodes.length).toBe(1)
    expect(result.minutePositions.length).toBe(3)
    const separated = [frame(5, BOT_LANE), frame(6, MID), frame(7, BOT_LANE)]
    expect(analyzeOneTimelineV2({ frames: separated }, SELF, 100).roamEpisodes.length).toBe(2)
  })

  it('keeps remote assists as event points without inferring that the player arrived in that lane', () => {
    const frames = [
      frame(5, MID, {}, [
        kill(300_000, {
          killerId: 4,
          victimId: 9,
          assistingParticipantIds: [SELF],
          position: BOT_LANE
        })
      ])
    ]
    const result = analyzeOneTimelineV2({ frames }, SELF, 100, ENEMY_MID, TEAMS)
    expect(result.killPoints.length).toBe(1)
    expect(result.earlyTakedowns).toBe(1)
    expect(result.roamEpisodes.length).toBe(0)
    expect(analyzeOneTimeline({ frames }, SELF, 100).firstRoam).toBeNull()
  })

  it('uses an earlier corroborated event to advance the episode start and mark success', () => {
    const frames = [frame(5, MID), frame(6, BOT_LANE, {}, [kill(340_000, { position: BOT_LANE })])]
    const result = analyzeOneTimelineV2({ frames }, SELF, 100, ENEMY_MID, TEAMS)
    expect(result.roamEpisodes).toEqual([{ startMs: 340_000, dir: 'bot', success: true }])
  })

  it('does not turn missing lane stats or a late final frame into zero lane differences', () => {
    const missing = frame(10, MID, { totalGold: undefined })
    expect(analyzeOneTimelineV2({ frames: [missing] }, SELF, 100, ENEMY_MID).laneDiff10).toBeNull()
    const late = { ...frame(10, MID), timestamp: 610_000 }
    expect(analyzeOneTimelineV2({ frames: [late] }, SELF, 100, ENEMY_MID).laneDiff10).toBeNull()
    const drifting = { ...frame(10, MID), timestamp: 600_080 }
    expect(analyzeOneTimelineV2({ frames: [drifting] }, SELF, 100, ENEMY_MID).laneDiff10).toEqual({
      cs: 10,
      gold: 500
    })
  })

  it('derives team kills from participant team IDs and excludes dead/base snapshots from map preference', () => {
    const frames = [
      frame(2, BOT_LANE, { championStats: { health: 0 } }),
      frame(3, { x: 400, y: 400 }),
      frame(4, MID, {}, [kill(235_000, { killerId: 8 }), kill(238_000, { killerId: 4 })])
    ]
    const result = analyzeOneTimelineV2({ frames }, SELF, 100, null, { 3: 100, 8: 100, 4: 200 })
    expect(result.earlyTeamKills).toBe(1)
    expect(result.zoneFrames).toEqual({ top: 0, mid: 1, bot: 0 })
    expect(result.roamEpisodes.length).toBe(0)
  })
})
