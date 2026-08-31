import {
  AutoHonorStrategy,
  AutoMatchmakingStrategy,
  AutoReportCategory,
  AutoReportScope
} from '@shared/shards/auto-gameflow'
import { defineStore } from 'pinia'
import { ref, shallowReactive, shallowRef } from 'vue'

export const useAutoGameflowStore = defineStore('shard:auto-gameflow-renderer', () => {
  const settings = shallowReactive({
    autoHonorEnabled: false,
    autoHonorStrategy: 'prefer-lobby-member' as AutoHonorStrategy,
    playAgainEnabled: false,
    autoAcceptEnabled: false,
    autoAcceptDelaySeconds: 0,
    autoReconnectEnabled: false,
    autoMatchmakingEnabled: false,
    autoMatchmakingMaximumMatchDuration: 0,
    autoMatchmakingRematchStrategy: 'never' as AutoMatchmakingStrategy,
    autoMatchmakingRematchFixedDuration: 2,
    autoMatchmakingDelaySeconds: 5,
    autoMatchmakingMinimumMembers: 1,
    autoMatchmakingWaitForInvitees: true,
    autoHandleInvitationsEnabled: false,
    autoSkipLeaderEnabled: false,
    invitationHandlingStrategies: {} as Record<string, string>,
    rejectInvitationWhenAway: false,
    autoSendARAMTeamSideEnabled: false,
    autoSendARAMTeamSideVisibleToTeam: true,
    autoReportEnabled: false,
    autoReportScope: 'opponents-only' as AutoReportScope,
    autoReportCategories: ['ASSISTING_ENEMY_TEAM'] as AutoReportCategory[]
  })

  const willAcceptAt = ref(-1)
  const willSearchMatch = ref(false)
  const willSearchMatchAt = ref(-1)
  const willReconnectAt = ref(-1)
  const activityStartStatus = ref('unavailable')
  const friendsToBeInvited = shallowRef<string[]>([])
  const lastAutoReportSummary = ref('')

  return {
    settings,

    willAcceptAt,
    willSearchMatch,
    willSearchMatchAt,
    willReconnectAt,
    activityStartStatus,
    friendsToBeInvited,
    lastAutoReportSummary
  }
})
