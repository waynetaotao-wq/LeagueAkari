import type { OngoingGameProviderValue } from '@renderer-shared/providers/ongoing-game'
import { createDefaultOngoingGamePanelPlayerCardTagSettings } from '@shared/shards/ongoing-game'

/** Synthetic roster used only by the component preview and contract tests. */
export function createMatchupFixture(championId = 13, opponentId = 105): OngoingGameProviderValue {
  const positions = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']
  const teams = {
    'TEAM-100': ['ally-top', 'ally-jungle', 'self', 'ally-bottom', 'ally-support'],
    'TEAM-200': ['enemy-top', 'enemy-jungle', 'enemy', 'enemy-bottom', 'enemy-support']
  }
  return {
    settings: {
      enabled: true,
      matchHistoryLoadCount: 20,
      orderPlayerBy: 'position',
      showChampionUsage: 'none',
      showMatchHistoryItemBorder: false,
      showJunglePathing: false,
      showJunglePathingForAllPlayers: false,
      playerCardTags: createDefaultOngoingGamePanelPlayerCardTagSettings()
    },
    queryStage: {
      phase: 'in-game',
      gameInfo: { gameId: 101, gameMode: 'CLASSIC', queueId: 420, queueType: 'RANKED_SOLO_5x5' }
    },
    draft: null,
    teams,
    championSelections: Object.fromEntries(
      Object.values(teams)
        .flat()
        .map((puuid, index) => [
          puuid,
          [98, 64, championId, 22, 40, 24, 121, opponentId, 202, 111][index]
        ])
    ),
    positionAssignments: Object.fromEntries(
      Object.values(teams).flatMap((team) =>
        team.map((puuid, index) => [
          puuid,
          { position: positions[index], role: null, isAutofilled: false }
        ])
      )
    ),
    mergedPremadeTeamMap: {},
    analysis: null,
    summoner: {
      enemy: {
        accountId: 1,
        displayName: '很长的召唤师名字用于预览',
        gameName: '很长的召唤师名字用于预览',
        internalName: 'matchup-preview',
        nameChangeFlag: false,
        percentCompleteForNextLevel: 0,
        privacy: 'PUBLIC',
        profileIconId: 1,
        puuid: 'enemy',
        rerollPoints: {
          currentPoints: 0,
          maxRolls: 0,
          numberOfRolls: 0,
          pointsCostToRoll: 0,
          pointsToReroll: 0
        },
        tagLine: '预览',
        summonerId: 1,
        summonerLevel: 100,
        unnamed: false,
        xpSinceLastLevel: 0,
        xpUntilNextLevel: 0
      }
    },
    rankedStats: {},
    championMastery: {},
    savedInfo: {},
    cachedGames: {},
    gameDetails: {},
    matchHistory: {},
    matchHistoryLoadingState: {},
    spells: {},
    isConnected: true,
    isSpectating: false,
    streamerMode: false,
    selfPuuid: 'self',
    reloadPlayer: () => {}
  }
}
