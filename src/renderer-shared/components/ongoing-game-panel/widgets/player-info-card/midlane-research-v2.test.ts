import { describe, expect, it } from 'vitest'

import { analyzeOneTimelineV2, classifyLaneCorridor } from './midlane-research'

const SELF = 3
const ENEMY_MID = 8
function frame(minute: number, selfPos: { x: number; y: number }, extra: Partial<any> = {}, events: any[] = []) {
  return {
    timestamp: minute * 60_000,
    participantFrames: {
      [SELF]: { position: selfPos, minionsKilled: 8 * minute, jungleMinionsKilled: 0, totalGold: 500 + 400 * minute, ...extra },
      [ENEMY_MID]: { position: { x: 7500, y: 7500 }, minionsKilled: 7 * minute, jungleMinionsKilled: 0, totalGold: 500 + 350 * minute }
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
        { type: 'CHAMPION_KILL', timestamp: 6 * 60_000 + 20_000, killerId: SELF, victimId: 9, assistingParticipantIds: [4], position: { x: 11800, y: 2600 } }
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
    const r = analyzeOneTimelineV2({ frames }, SELF, 100, ENEMY_MID)
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
      { type: 'CHAMPION_KILL', timestamp: 7 * 60_000, killerId: SELF, victimId: ENEMY_MID, assistingParticipantIds: [], position: { x: 7300, y: 7500 } },
      { type: 'CHAMPION_KILL', timestamp: 7 * 60_000 + 30_000, killerId: ENEMY_MID, victimId: SELF, assistingParticipantIds: [], position: { x: 7400, y: 7300 } },
      // 在下路被单杀：属于游走被反，不计入"被单杀（对线）"
      { type: 'CHAMPION_KILL', timestamp: 7 * 60_000 + 50_000, killerId: 9, victimId: SELF, assistingParticipantIds: [], position: { x: 12000, y: 2500 } }
    ]
    const r = analyzeOneTimelineV2({ frames }, SELF, 100, ENEMY_MID)
    expect(r.laneDiff10).toEqual({ cs: 10, gold: 500 })
    expect(r.soloKills).toBe(1)
    expect(r.soloDeaths).toBe(1)
  })

  it('returns no lane diff when the enemy mid is unknown', () => {
    const frames = Array.from({ length: 12 }, (_, m) => frame(m, MID))
    const r = analyzeOneTimelineV2({ frames }, SELF, 100, null)
    expect(r.laneDiff10).toBeNull()
  })
})
