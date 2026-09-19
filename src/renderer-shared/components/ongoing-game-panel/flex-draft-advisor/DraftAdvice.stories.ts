import type { Meta, StoryObj } from '@storybook/vue3-vite'

import DraftAdviceDemo from './DraftAdviceDemo.vue'

const meta = {
  title: 'Renderer Shared/Ongoing Game/Flex Draft Advisor',
  component: DraftAdviceDemo,
  parameters: { akariStoryPanelMaxWidth: 1550 }
} satisfies Meta<typeof DraftAdviceDemo>

export default meta
type Story = StoryObj<typeof meta>
export const Normal: Story = {}
export const Locked: Story = { args: { initialScenario: 'locked' } }
export const Inferred: Story = { args: { initialScenario: 'inferred' } }
export const Partial: Story = { args: { initialScenario: 'partial' } }
export const Unfavorable: Story = { args: { initialScenario: 'unfavorable' } }
export const SelfLocked: Story = { args: { initialScenario: 'selfLocked' } }
export const Empty: Story = { args: { initialScenario: 'empty' } }
export const Solo: Story = { args: { initialScenario: 'solo' } }
