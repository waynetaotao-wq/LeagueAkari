import { GAME_REFOCUS_MAIN_NAMESPACE, type GameRefocusRendererContext } from './context'
import { useGameRefocusStore } from './store'

export async function syncGameRefocusState(context: GameRefocusRendererContext) {
  const store = useGameRefocusStore()

  await context.piniaMobxUtils.sync(GAME_REFOCUS_MAIN_NAMESPACE, 'settings', store.settings)
  await context.piniaMobxUtils.sync(GAME_REFOCUS_MAIN_NAMESPACE, 'state', store.state)
}
