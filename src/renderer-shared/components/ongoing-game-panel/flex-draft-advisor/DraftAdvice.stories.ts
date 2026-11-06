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
export const Composition: Story = { args: { initialScenario: 'composition' } }
export const MixedPosition: Story = { args: { initialScenario: 'mixedPosition' } }
export const StaleHover: Story = { args: { initialScenario: 'staleHover' } }
export const UnavailablePool: Story = { args: { initialScenario: 'unavailablePool' } }
export const FullUnavailablePool: Story = { args: { initialScenario: 'fullUnavailablePool' } }
export const FullAutomaticPool: Story = { args: { initialScenario: 'fullAutomaticPool' } }
export const BanCombination: Story = { args: { initialScenario: 'banCombination' } }
export const HistoryStates: Story = { args: { initialScenario: 'historyStates' } }
export const AllyHistoryError: Story = { args: { initialScenario: 'allyHistoryError' } }
export const Clash: Story = { args: { initialScenario: 'clash' } }
export const ClashEmpty: Story = { args: { initialScenario: 'clashEmpty' } }
export const ClashOneBan: Story = { args: { initialScenario: 'clashOneBan' } }
export const ClashWaiting: Story = { args: { initialScenario: 'clashWaiting' } }
export const ClashSecondBan: Story = { args: { initialScenario: 'clashSecondBan' } }
export const ClashOwnFinished: Story = { args: { initialScenario: 'clashOwnFinished' } }
export const ClashLockedPool: Story = { args: { initialScenario: 'clashLockedPool' } }
export const AramClash: Story = { args: { initialScenario: 'aramClash' } }
export const Locked: Story = { args: { initialScenario: 'locked' } }
export const Inferred: Story = { args: { initialScenario: 'inferred' } }
export const Partial: Story = { args: { initialScenario: 'partial' } }
export const Unfavorable: Story = { args: { initialScenario: 'unfavorable' } }
export const SelfLocked: Story = { args: { initialScenario: 'selfLocked' } }
export const Empty: Story = { args: { initialScenario: 'empty' } }
export const Solo: Story = { args: { initialScenario: 'solo' } }
