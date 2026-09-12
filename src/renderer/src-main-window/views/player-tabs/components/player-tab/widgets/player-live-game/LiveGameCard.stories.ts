import type { Meta, StoryObj } from '@storybook/vue3-vite'

import LiveGameCard from './LiveGameCard.vue'
import { emptyLiveGameState } from './controller'

// Synthetic presentation states. These stories never query a player or launch a spectator.
const meta = {
  title: 'Main Window/Player/Live Game',
  component: LiveGameCard,
  parameters: { akariStoryPanelMaxWidth: 1000 },
  args: {
    state: {
      ...emptyLiveGameState(),
      status: 'in-game',
      source: 'friend',
      checkedAt: Date.now(),
      gameId: 1234567890,
      championId: 238,
      queueId: 420,
      canSpectate: true
    },
    queueName: '排位赛 · 单双排',
    reason: 'friend',
    canLaunch: true,
    launching: false
  }
} satisfies Meta<typeof LiveGameCard>
export default meta
type Story = StoryObj<typeof meta>
export const Spectatable: Story = {}
export const Narrow: Story = { parameters: { akariStoryPanelMaxWidth: 560 } }
export const NoPermission: Story = {
  args: { state: { ...meta.args.state, source: 'sgp', canSpectate: false }, reason: 'noGrant' }
}
export const Unavailable: Story = {
  args: { state: emptyLiveGameState(), queueName: '', reason: 'unknown' }
}
export const NotInGame: Story = {
  args: {
    state: {
      ...emptyLiveGameState(),
      status: 'not-in-game',
      source: 'friend',
      checkedAt: Date.now()
    },
    queueName: '',
    reason: 'friend'
  }
}
