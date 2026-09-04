<template>
  <div class="flex flex-col gap-2">
    <MatchHistoryPagination />
    <ReviewStudioEntry :puuid="puuid" :sgp-server-id="sgpServerId" />
    <MasteryResearch />
    <RatingCalibrateFromPlayer />
    <NormalTagBlock />
    <SummaryPane />
    <ChampionMasteryPane />
    <RecentlyPlayers side="ally" />
    <RecentlyPlayers side="enemy" />
    <PlayerChallenges />
    <EncounteredGames />
  </div>
</template>

<script setup lang="ts">
import ReviewStudioEntry from '@renderer-shared/components/review-studio/ReviewStudioEntry.vue'

import { usePlayerTab } from './context'
import ChampionMasteryPane from './widgets/ChampionMasteryPane.vue'
import EncounteredGames from './widgets/EncounteredGames.vue'
import MasteryResearch from './widgets/MasteryResearch.vue'
import MatchHistoryPagination from './widgets/match-history-pagination'
import NormalTagBlock from './widgets/NormalTagBlock.vue'
import PlayerChallenges from './widgets/PlayerChallenges.vue'
import RatingCalibrateFromPlayer from './widgets/RatingCalibrateFromPlayer.vue'
import RecentlyPlayers from './widgets/RecentlyPlayers.vue'
import SummaryPane from './widgets/SummaryPane.vue'

const { puuid, sgpServerId } = usePlayerTab()
</script>
