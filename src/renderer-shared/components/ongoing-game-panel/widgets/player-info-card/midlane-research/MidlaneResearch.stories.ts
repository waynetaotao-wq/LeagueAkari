import type { Meta, StoryObj } from '@storybook/vue3-vite'

import MidlaneResearchDemo from './MidlaneResearchDemo.vue'

const meta = {
  title: 'Renderer Shared/Ongoing Game/Midlane Research',
  component: MidlaneResearchDemo,
  parameters: { akariStoryPanelMaxWidth: 560 }
} satisfies Meta<typeof MidlaneResearchDemo>

export default meta
type Story = StoryObj<typeof meta>
export const Roaming: Story = {}
export const Solo: Story = { args: { initialScenario: 'solo' } }
export const Lane: Story = { args: { initialScenario: 'lane' } }
export const SmallSample: Story = { args: { initialScenario: 'small' } }
export const Failures: Story = { args: { initialScenario: 'failures' } }
export const Loading: Story = { args: { initialScenario: 'loading' } }
export const Empty: Story = { args: { initialScenario: 'empty' } }
export const NearWindowEdge: Story = { args: { edge: true } }
export const Ally: Story = { args: { initialScenario: 'ally' } }
