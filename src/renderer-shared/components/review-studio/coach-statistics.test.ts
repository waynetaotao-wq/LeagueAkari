import type { ChampionDataDetails } from '@shared/data-adapter/champion-data'
import type { MatchupBuildResult } from '@shared/types/counter-intel'
import { describe, expect, it } from 'vitest'

import {
  REVIEW_STATISTICS_MIN_GAMES,
  REVIEW_STATISTICS_ROWS,
  REVIEW_STATISTICS_VERSUS_ROWS,
  normalizeReviewPatch,
  readReviewChampionStatistics,
  readReviewMatchupStatistics,
  selectReviewStatisticsPatch,
  summarizeReviewLoadoutHistory
} from './coach-statistics'
import type { ReviewDigest, ReviewMatch } from './types'

const performance = (
  games: number | null,
  wins: number | null,
  pickRate: number | null = null
) => ({
  games,
  wins,
  winRate: games && wins !== null ? wins / games : null,
  pickRate,
  rank: null,
  averagePlacement: null,
  firstPlaceRate: null
})

function details(overrides: Partial<ChampionDataDetails> = {}): ChampionDataDetails {
  return {
    metadata: { source: 'opgg', mode: 'ranked', patch: '16.23', dataDate: null, updatedAt: null },
    championId: 238,
    summary: {
      championId: 238,
      position: 'middle',
      performance: {
        games: 12_000,
        wins: null,
        winRate: 0.501,
        pickRate: 0.042,
        banRate: 0.1,
        kda: 2.4,
        rank: 12,
        rankChange: 0,
        strengthTier: 2,
        averagePlacement: null,
        firstPlaceRate: null
      },
      counterChampionIds: []
    },
    sections: {
      matchups: [
        { championId: 103, relationship: 'unknown', performance: performance(400, 188) },
        { championId: 75, relationship: 'unknown', performance: performance(300, 171) }
      ],
      summonerSpells: [
        { spellIds: [4, 12], performance: performance(1500, 735, 0.125) },
        { spellIds: [14, 4], performance: performance(9000, 4545, 0.75) },
        // Not a pair: left out.
        { spellIds: [4], performance: performance(50, 20, 0.004) }
      ],
      itemBuilds: [
        {
          slot: 'starting',
          options: [{ itemIds: [1055, 2003], performance: performance(8000, 4000, 0.67) }]
        },
        {
          slot: 'boots',
          options: [{ itemIds: [3158], performance: performance(7000, 3570, 0.58) }]
        },
        {
          slot: 'core',
          options: [
            { itemIds: [6692, 3142, 3814], performance: performance(900, 480, 0.075) },
            // No sample behind it: left out.
            { itemIds: [6692, 3142, 6694], performance: performance(0, 0, 0) }
          ]
        },
        { slot: 'last', options: [{ itemIds: [3156], performance: performance(3000, 1560) }] }
      ],
      runePages: [
        {
          primaryStyleId: 8300,
          secondaryStyleId: 8100,
          primaryRuneIds: [8369, 8304, 8345, 8347],
          secondaryRuneIds: [8143, 8106],
          statShardIds: [5008, 5008, 5001],
          performance: performance(2400, 1248, 0.2)
        },
        {
          primaryStyleId: 8100,
          secondaryStyleId: 8200,
          primaryRuneIds: [8112, 8143, 8140, 8106],
          secondaryRuneIds: [8210, 8237],
          statShardIds: [5008, 5008, 5001],
          performance: performance(5000, 2550, 0.42)
        },
        // A page with a rune missing says nothing usable.
        {
          primaryStyleId: 8100,
          secondaryStyleId: 8200,
          primaryRuneIds: [8112, 8143, 8140],
          secondaryRuneIds: [8210, 8237],
          statShardIds: [],
          performance: performance(700, 300, 0.05)
        }
      ]
    },
    ...overrides
  }
}

const expected = { championId: 238, position: 'middle', opponentChampionId: 103 }

describe('normalizeReviewPatch', () => {
  it.each([
    ['16.23', '16.23'],
    ['16.01', '16.1'],
    ['16.23.734', '16.23'],
    [' 16.5 ', '16.5'],
    ['latest', null],
    ['', null],
    [null, null]
  ])('reads %j as %j', (patch, normalized) => {
    expect(normalizeReviewPatch(patch)).toBe(normalized)
  })
})

describe('selectReviewStatisticsPatch', () => {
  it('asks for the patch of the game when the source still has it', () => {
    expect(selectReviewStatisticsPatch(['16.23', '16.22', '16.21'], '16.22')).toEqual({
      patch: '16.22',
      samePatch: true
    })
    // The same patch written with a leading zero.
    expect(selectReviewStatisticsPatch(['16.02', '16.01'], '16.1')).toEqual({
      patch: '16.01',
      samePatch: true
    })
  })

  it('falls back to the newest patch and says that it is another one', () => {
    expect(selectReviewStatisticsPatch(['16.23', '16.22'], '16.15')).toEqual({
      patch: '16.23',
      samePatch: false
    })
  })

  it('has nothing to ask for when the source lists no usable patch', () => {
    expect(selectReviewStatisticsPatch([], '16.23')).toBeNull()
    expect(selectReviewStatisticsPatch(['latest'], '16.23')).toBeNull()
  })
})

describe('readReviewChampionStatistics', () => {
  it('reads the champion, the matchup and each table, most used first', () => {
    expect(readReviewChampionStatistics(details(), expected)).toEqual({
      champion: { games: 12_000, winRate: 0.501, pickRate: 0.042 },
      matchup: { games: 400, wins: 188 },
      general: {
        runePages: [
          {
            primaryStyle: 8100,
            secondaryStyle: 8200,
            primary: [8112, 8143, 8140, 8106],
            secondary: [8210, 8237],
            shards: [5008, 5008, 5001],
            games: 5000,
            wins: 2550,
            pickRate: 0.42
          },
          {
            primaryStyle: 8300,
            secondaryStyle: 8100,
            primary: [8369, 8304, 8345, 8347],
            secondary: [8143, 8106],
            shards: [5008, 5008, 5001],
            games: 2400,
            wins: 1248,
            pickRate: 0.2
          }
        ],
        spells: [
          { ids: [14, 4], games: 9000, wins: 4545, pickRate: 0.75 },
          { ids: [4, 12], games: 1500, wins: 735, pickRate: 0.125 }
        ],
        // The same item twice in a starting set is kept as it is.
        starting: [{ ids: [1055, 2003], games: 8000, wins: 4000, pickRate: 0.67 }],
        boots: [{ ids: [3158], games: 7000, wins: 3570, pickRate: 0.58 }],
        core: [{ ids: [6692, 3142, 3814], games: 900, wins: 480, pickRate: 0.075 }],
        late: [{ ids: [3156], games: 3000, wins: 1560, pickRate: null }]
      }
    })
  })

  it('keeps only the most used rows of a long table', () => {
    const many = details()
    many.sections.runePages = Array.from({ length: 12 }, (_, index) => ({
      primaryStyleId: 8100,
      secondaryStyleId: 8200,
      primaryRuneIds: [8112, 8143, 8140, 8106],
      secondaryRuneIds: [8210, 8237],
      statShardIds: [],
      performance: performance(100 + index, 50, 0.01)
    }))
    const pages = readReviewChampionStatistics(many, expected)!.general.runePages

    expect(pages).toHaveLength(REVIEW_STATISTICS_ROWS.runePages)
    expect(pages[0].games).toBe(111)
  })

  it('drops thin rows from the general tables too, which an unusual role is full of', () => {
    const offRole = details()
    offRole.sections.summonerSpells = [
      { spellIds: [4, 14], performance: performance(875, 454, 0.657) },
      { spellIds: [12, 14], performance: performance(25, 14, 0.019) }
    ]
    // The source lists overall numbers only for the roles a champion is usually played in.
    offRole.summary.performance = {
      ...offRole.summary.performance,
      games: null,
      winRate: null,
      pickRate: null
    }
    const read = readReviewChampionStatistics(offRole, expected)!

    expect(read.general.spells).toEqual([{ ids: [4, 14], games: 875, wins: 454, pickRate: 0.657 }])
    expect(read.champion).toEqual({ games: null, winRate: null, pickRate: null })
  })

  it('has no matchup when the source does not list this opponent', () => {
    const read = readReviewChampionStatistics(details(), { ...expected, opponentChampionId: 54 })!
    expect(read.matchup).toBeNull()
    expect(
      readReviewChampionStatistics(details(), { ...expected, opponentChampionId: null })!.matchup
    ).toBeNull()
  })

  it('leaves tables empty that the source does not have', () => {
    const bare = readReviewChampionStatistics(details({ sections: {} }), expected)!
    expect(bare.general).toEqual({
      runePages: [],
      spells: [],
      starting: [],
      boots: [],
      core: [],
      late: []
    })
  })

  it.each([
    ['another champion', details({ championId: 103 })],
    ['another position', details({ summary: { ...details().summary, position: 'top' } })],
    ['another source', details({ metadata: { ...details().metadata, source: 'lolps' } })]
  ])('refuses an answer about %s', (_, answer) => {
    expect(readReviewChampionStatistics(answer, expected)).toBeNull()
  })

  it('does not count a row with impossible numbers', () => {
    const odd = details()
    odd.sections.summonerSpells = [
      { spellIds: [4, 14], performance: performance(100, 140, 0.5) },
      { spellIds: [4, 12], performance: performance(100, 40, 1.5) }
    ]
    // More wins than games is dropped; a pick rate above one is unknown.
    expect(readReviewChampionStatistics(odd, expected)!.general.spells).toEqual([
      { ids: [4, 12], games: 100, wins: 40, pickRate: null }
    ])
  })
})

describe('readReviewMatchupStatistics', () => {
  const result = (overrides: Partial<MatchupBuildResult> = {}): MatchupBuildResult => ({
    myChampionId: 238,
    opponentChampionId: 103,
    position: 'middle',
    region: 'kr',
    tier: 'emerald_plus',
    version: '16.23',
    sourceVersion: '16.23',
    meta: { play: 400, win: 188 },
    overlay: {
      summoner_spells: [{ ids: [4, 12], play: 120, win: 66, pick_rate: 0.3 }],
      runes: [
        {
          id: 1,
          primary_page_id: 8300,
          primary_rune_ids: [8369, 8304, 8345, 8347],
          secondary_page_id: 8100,
          secondary_rune_ids: [8143, 8106],
          stat_mod_ids: [5008, 5008, 5001],
          play: 90,
          win: 50,
          pick_rate: 0.22
        }
      ],
      skill_masteries: [],
      starter_items: [{ ids: [1055, 2003], play: 200, win: 96, pick_rate: 0.5 }],
      boots: [],
      core_items: [{ ids: [6692, 3142, 3814], play: 40, win: 22, pick_rate: 0.1 }],
      last_items: [],
      prism_items: []
    },
    parsedSections: ['summoner_spells', 'runes'],
    targetVerified: true,
    updatedAt: '2026-11-23T00:00:00Z',
    ...overrides
  })
  const pair = { championId: 238, opponentChampionId: 103 }

  it('reads the tables the main process verified for this opponent', () => {
    expect(readReviewMatchupStatistics(result(), pair)).toEqual({
      runePages: [
        {
          primaryStyle: 8300,
          secondaryStyle: 8100,
          primary: [8369, 8304, 8345, 8347],
          secondary: [8143, 8106],
          shards: [5008, 5008, 5001],
          games: 90,
          wins: 50,
          pickRate: 0.22
        }
      ],
      spells: [{ ids: [4, 12], games: 120, wins: 66, pickRate: 0.3 }],
      starting: [{ ids: [1055, 2003], games: 200, wins: 96, pickRate: 0.5 }],
      boots: [],
      core: [{ ids: [6692, 3142, 3814], games: 40, wins: 22, pickRate: 0.1 }],
      late: []
    })
  })

  it('leaves out setups with too few games to say anything about', () => {
    const thin = result()
    Object.assign(thin.overlay!, {
      summoner_spells: [
        { ids: [4, 12], play: REVIEW_STATISTICS_MIN_GAMES, win: 16, pick_rate: 0.3 },
        // One game short: a win rate over this few games is noise.
        { ids: [4, 14], play: REVIEW_STATISTICS_MIN_GAMES - 1, win: 20, pick_rate: 0.29 }
      ],
      core_items: [{ ids: [6692, 3142, 3814], play: 12, win: 9, pick_rate: 0.1 }]
    })
    const read = readReviewMatchupStatistics(thin, pair)!

    expect(read.spells).toEqual([{ ids: [4, 12], games: 30, wins: 16, pickRate: 0.3 }])
    expect(read.core).toEqual([])
    expect(REVIEW_STATISTICS_MIN_GAMES).toBe(30)
  })

  it('says when the numbers of a rune row count every page with its keystone and secondary tree', () => {
    // The main process gives the matchup's rune rows as the web page shows them: the games and
    // the win rate of one keystone with one secondary tree, with the runes of the most common page.
    const grouped = result()
    Object.assign(grouped.overlay!, {
      runes: [
        {
          id: 1,
          primary_page_id: 8300,
          primary_rune_ids: [8369, 8304, 8345, 8347],
          secondary_page_id: 8100,
          secondary_rune_ids: [8143, 8106],
          stat_mod_ids: [5008, 5008, 5001],
          play: 196,
          win: 93,
          pick_rate: 0.5868,
          is_group_total: true
        }
      ]
    })

    expect(readReviewMatchupStatistics(grouped, pair)!.runePages[0]).toMatchObject({
      games: 196,
      wins: 93,
      groupTotal: true
    })
    // A row that is one exact page carries no such mark.
    expect(readReviewMatchupStatistics(result(), pair)!.runePages[0].groupTotal).toBeUndefined()
  })

  it('keeps more single items than rune pages, and fewer of everything for one opponent', () => {
    const many = result()
    Object.assign(many.overlay!, {
      last_items: Array.from({ length: 20 }, (_, index) => ({
        ids: [3000 + index],
        play: 400 - index,
        win: 200,
        pick_rate: 0.1
      }))
    })
    expect(readReviewMatchupStatistics(many, pair)!.late).toHaveLength(
      REVIEW_STATISTICS_VERSUS_ROWS.late
    )
    expect(REVIEW_STATISTICS_ROWS.late).toBeGreaterThan(REVIEW_STATISTICS_VERSUS_ROWS.late)
    expect(REVIEW_STATISTICS_ROWS.late).toBeGreaterThan(REVIEW_STATISTICS_ROWS.runePages)
  })

  it.each([
    [
      'the answer was not verified for this opponent',
      result({ targetVerified: false, overlay: null })
    ],
    ['there is no overlay', result({ overlay: null })],
    ['it is about another opponent', result({ opponentChampionId: 75 })],
    ['it is about another champion', result({ myChampionId: 91 })],
    ['every table is empty', result({ overlay: { runes: [], summoner_spells: 'broken' } })],
    ['nothing came back', null]
  ])('has nothing when %s', (_, answer) => {
    expect(readReviewMatchupStatistics(answer, pair)).toBeNull()
  })
})

describe('summarizeReviewLoadoutHistory', () => {
  let nextId = 1
  const game = (
    values: {
      win?: boolean
      keystone?: number | null
      spells?: number[]
      firstItem?: number | null
      /** The second and third completed items; a path is counted only with all three. */
      laterItems?: number[]
      /** The six runes with the three numbers the server keeps for each. */
      runes?: number[][]
      duration?: number
      championId?: number
      opponent?: number | null
      position?: ReviewMatch['meta']['position']
      puuid?: string
      digest?: boolean
    } = {}
  ): ReviewMatch => {
    const digest: ReviewDigest = {
      metrics: {},
      coreItems:
        values.firstItem === null
          ? []
          : [values.firstItem ?? 6692, ...(values.laterItems ?? [])].map((itemId, index) => ({
              timestamp: 600_000 + index * 300_000,
              itemId
            })),
      bootsItemId: null,
      keystone: values.keystone === undefined ? 8112 : values.keystone,
      summonerSpells: values.spells ?? [4, 14],
      skillPriority: null,
      challenges: null,
      ...(values.runes ? { runes: values.runes } : {})
    }
    return {
      meta: {
        gameId: nextId++,
        sgpServerId: 'TEST',
        puuid: values.puuid ?? 'player-8',
        gameCreation: 0,
        gameDuration: values.duration ?? 1500,
        queueId: 420,
        patch: '16.23',
        championId: values.championId ?? 238,
        position: values.position ?? 'MIDDLE',
        participantId: 8,
        teamId: 100,
        opponentId: 3,
        opponentChampionId: values.opponent === undefined ? 103 : values.opponent,
        win: values.win ?? false
      },
      participants: [],
      frames: [],
      events: [],
      moments: [],
      snapshots: [],
      quality: {} as ReviewMatch['quality'],
      digest: values.digest === false ? null : digest
    }
  }

  it('counts how each setup went on the same champion in the same role', () => {
    const target = game()
    const archive = [
      game({ win: true }),
      game({ win: true }),
      game({ win: false }),
      // The same two spells on the other keys are the same setup.
      game({ win: true, keystone: 8369, spells: [14, 4], opponent: 75, firstItem: 3142 }),
      game({ win: false, keystone: 8369, spells: [12, 4], opponent: 75, firstItem: 3142 })
    ]

    expect(summarizeReviewLoadoutHistory(target, archive)).toEqual({
      champion: {
        games: 5,
        wins: 3,
        keystones: [
          { ids: [8112], games: 3, wins: 2 },
          { ids: [8369], games: 2, wins: 1 }
        ],
        // None of these games kept its whole rune page or finished three items.
        pages: [],
        spells: [
          { ids: [4, 14], games: 4, wins: 3 },
          { ids: [4, 12], games: 1, wins: 0 }
        ],
        firstItems: [
          { ids: [6692], games: 3, wins: 2 },
          { ids: [3142], games: 2, wins: 1 }
        ],
        corePaths: []
      },
      // Three of the five were against the same lane opponent.
      matchup: {
        games: 3,
        wins: 2,
        keystones: [{ ids: [8112], games: 3, wins: 2 }],
        pages: [],
        spells: [{ ids: [4, 14], games: 3, wins: 2 }],
        firstItems: [{ ids: [6692], games: 3, wins: 2 }],
        corePaths: []
      },
      // The reviewed game was archived without its runes, so there is nothing to look up.
      runes: []
    })
  })

  it('counts whole rune pages and three-item paths only from games that record them', () => {
    const page = (keystone: number, last: number) =>
      [keystone, 8143, 8138, 8135, 8304, last].map((id) => [id, 0, 0, 0])
    const history = summarizeReviewLoadoutHistory(game(), [
      game({ win: true, runes: page(8112, 8347), laterItems: [3142, 6694] }),
      game({ win: false, runes: page(8112, 8347), laterItems: [3142, 6694] }),
      // Another last rune is another page; another third item is another path.
      game({ win: true, runes: page(8112, 8345), laterItems: [3142, 3814] }),
      // Five runes are not a page; two completed items are not a path.
      game({ win: true, runes: page(8112, 8347).slice(0, 5), laterItems: [3142] }),
      // The two runes of the second tree have no order: picked the other way round, it is
      // still the first page.
      game({
        win: true,
        runes: [8112, 8143, 8138, 8135, 8347, 8304].map((id) => [id, 0, 0, 0])
      }),
      game({ win: true })
    ])!

    expect(history.champion.games).toBe(6)
    expect(history.champion.pages).toEqual([
      { ids: [8112, 8143, 8138, 8135, 8304, 8347], games: 3, wins: 2 },
      { ids: [8112, 8143, 8138, 8135, 8304, 8345], games: 1, wins: 1 }
    ])
    expect(history.champion.corePaths).toEqual([
      { ids: [6692, 3142, 6694], games: 2, wins: 1 },
      { ids: [6692, 3142, 3814], games: 1, wins: 1 }
    ])
  })

  it('collects what each rune of the reviewed game recorded in the other games', () => {
    const target = game({
      runes: [
        [8369, 1192, 836, 0],
        [8304, 14, 50, 0]
      ]
    })
    const history = summarizeReviewLoadoutHistory(target, [
      game({
        duration: 1800,
        runes: [
          [8369, 900, 640, 0],
          [8304, 12, 0, 0]
        ]
      }),
      // This game took the keystone with another second rune.
      game({
        duration: 1320,
        runes: [
          [8369, 400, 310, 0],
          [8345, 0, 0, 0]
        ]
      }),
      // Archived before the runes were kept: nothing to add.
      game()
    ])!

    expect(history.runes).toEqual([
      {
        id: 8369,
        samples: [
          { stats: [900, 640, 0], duration: 1800 },
          { stats: [400, 310, 0], duration: 1320 }
        ]
      },
      { id: 8304, samples: [{ stats: [12, 0, 0], duration: 1800 }] }
    ])
  })

  it('leaves out the reviewed game, other champions, roles and players, and games without a digest', () => {
    const target = game()
    const archive = [
      // The reviewed game itself may sit in the archive already.
      { ...game({ win: true }), meta: { ...target.meta } },
      game({ championId: 103 }),
      game({ position: 'TOP' }),
      game({ puuid: 'someone-else' }),
      game({ digest: false }),
      game({ win: true, opponent: 75 })
    ]
    const history = summarizeReviewLoadoutHistory(target, archive)!

    expect(history.champion.games).toBe(1)
    expect(history.matchup).toBeNull()
  })

  it('counts a game once even when the archive lists it twice', () => {
    const other = game({ win: true })
    expect(summarizeReviewLoadoutHistory(game(), [other, other])!.champion.games).toBe(1)
  })

  it('skips what a game does not record instead of counting it as a setup', () => {
    const history = summarizeReviewLoadoutHistory(game(), [
      game({ keystone: null, spells: [4], firstItem: null }),
      game({ win: true })
    ])!

    expect(history.champion.games).toBe(2)
    expect(history.champion.keystones).toEqual([{ ids: [8112], games: 1, wins: 1 }])
    expect(history.champion.spells).toEqual([{ ids: [4, 14], games: 1, wins: 1 }])
    expect(history.champion.firstItems).toEqual([{ ids: [6692], games: 1, wins: 1 }])
  })

  it('has no history without other games, or for a game whose role is unknown', () => {
    expect(summarizeReviewLoadoutHistory(game(), [])).toBeNull()
    expect(
      summarizeReviewLoadoutHistory(game({ position: 'UNKNOWN' }), [game({ position: 'UNKNOWN' })])
    ).toBeNull()
  })

  it('has no matchup part when the lane opponent of the game is unknown', () => {
    const history = summarizeReviewLoadoutHistory(game({ opponent: null }), [game(), game()])!
    expect(history.champion.games).toBe(2)
    expect(history.matchup).toBeNull()
  })
})
