<template>
  <DraftAdviceView
    v-if="context && target"
    v-model:selected-role="selectedRole"
    v-model:selected-opponent="selectedOpponent"
    v-model:comfortable="comfortable"
    :context="context"
    :target="target"
    :role="role"
    :histories="histories"
    :bans="bans"
    :picks="picks"
    :champion-names="championNames"
    :pickable-ids="pickableIds"
    :player-names="playerNames"
    :loading="loading"
    :history-loading="historyLoading"
    :failed="failed"
    :patch="result.patch"
    :loaded-players="loadedPlayers"
    @retry="retry"
  />
</template>

<script setup lang="ts">
import DraftAdviceView from './DraftAdviceView.vue'
import { useDraftAdvisor } from './use-draft-advisor'

const {
  context,
  histories,
  role,
  target,
  bans,
  picks,
  championNames,
  pickableIds,
  playerNames,
  selectedRole,
  selectedOpponent,
  comfortable,
  loading,
  failed,
  result,
  loadedPlayers,
  historyLoading,
  retry
} = useDraftAdvisor()
</script>
