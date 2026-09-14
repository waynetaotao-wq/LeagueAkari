import { createFriendRequestTestSnapshot } from '@shared/shards/friend-request-test'
import type { Meta, StoryObj } from '@storybook/vue3-vite'

import FriendRequestTestPanel from './FriendRequestTestPanel.vue'

// Presentation fixtures only: these stories never connect to a client or send requests.
const meta = {
  title: 'Main Window/Toolkit/Friend Request Test',
  component: FriendRequestTestPanel,
  parameters: { akariStoryPanelMaxWidth: 760 },
  args: {
    snapshot: createFriendRequestTestSnapshot(),
    available: true,
    busy: false,
    startError: null
  }
} satisfies Meta<typeof FriendRequestTestPanel>
export default meta
type Story = StoryObj<typeof meta>

export const Ready: Story = {}
export const Disconnected: Story = { args: { available: false } }
export const Paused: Story = {
  args: {
    snapshot: {
      ...createFriendRequestTestSnapshot(),
      active: true,
      paused: true,
      phase: 'waiting',
      options: {
        riotId: '演示账号#TEST',
        durationMinutes: 5,
        intervalSeconds: 0.5,
        removeAccepted: true,
        consented: true
      },
      target: { puuid: 'synthetic-target', gameName: '演示账号', tagLine: 'TEST' },
      remainingMs: 240_000,
      waitRemainingMs: 500,
      sent: 12,
      withdrawn: 10,
      removed: 1,
      lastSendIntervalMs: 751,
      mayHaveRelationship: true
    }
  }
}
export const RateLimited: Story = {
  args: {
    snapshot: {
      ...Paused.args!.snapshot!,
      active: false,
      paused: false,
      phase: 'failed',
      reason: 'rate-limited',
      httpStatus: 429,
      lastOperation: 'send'
    }
  }
}
export const Narrow: Story = { ...RateLimited, parameters: { akariStoryPanelMaxWidth: 420 } }
