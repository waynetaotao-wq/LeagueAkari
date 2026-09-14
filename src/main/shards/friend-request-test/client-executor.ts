import type {
  FriendRequestTestChatError,
  FriendRequestTestTarget
} from '@shared/shards/friend-request-test'
import type { AxiosRequestConfig } from 'axios'
import { z } from 'zod'

import type { LeagueClientMain } from '../league-client'
import type { FriendRequestTestApi, FriendTestRelationship } from './context'

const aliasesSchema = z.array(
  z.object({
    puuid: z.string().min(1),
    gameName: z.string().min(1),
    tagLine: z.string().min(1)
  })
)
const friendsSchema = z.array(z.object({ id: z.string(), puuid: z.string() }))
const requestsSchema = z.array(
  z.object({
    puuid: z.string(),
    direction: z.enum(['in', 'out', 'both'])
  })
)
const chatErrorEventSchema = z.object({
  eventType: z.literal('Create'),
  data: z.object({
    code: z.number().int().min(0).max(9999),
    message: z.string()
  })
})
const chatErrorCategorySchema = z.enum(['wait', 'cancel', 'modify', 'auth', 'continue'])

export class FriendRequestTestClientExecutor implements FriendRequestTestApi {
  constructor(private readonly _leagueClient: Pick<LeagueClientMain, 'request' | 'events'>) {}

  watchChatErrors(listener: (error: FriendRequestTestChatError) => void) {
    // The client UI consumes this error queue. Listen for new events instead of polling
    // old errors or deleting them. These are diagnostic hints, not target-specific proof.
    return this._leagueClient.events.on('/lol-chat/v1/errors/:id', (event: unknown) => {
      const parsed = chatErrorEventSchema.safeParse(event)
      if (!parsed.success) return
      const category = chatErrorCategorySchema.safeParse(parsed.data.data.message)
      listener({
        code: parsed.data.data.code,
        category: category.success ? category.data : 'unknown'
      })
    })
  }

  private async _request(config: AxiosRequestConfig, signal: AbortSignal) {
    // Do not retry ambiguous writes, including network errors, in either Axios layer.
    // This calls the main-process LCU client directly, bypassing renderer HTTP retries.
    const response = await this._leagueClient.request<unknown>({
      ...config,
      signal,
      timeout: 10_000,
      'axios-retry': { retries: 0 }
    })
    return response.data
  }

  async resolve(gameName: string, tagLine: string, signal: AbortSignal) {
    const raw = await this._request(
      {
        method: 'POST',
        url: '/lol-summoner/v1/summoners/aliases',
        data: [{ gameName, tagLine }]
      },
      signal
    )
    const parsed = aliasesSchema.safeParse(raw)
    if (!parsed.success) throw new Error('invalid-response')
    const normalized = (value: string) => value.normalize('NFC').trim().toLowerCase()
    const matching = parsed.data.filter(
      (player) =>
        normalized(player.gameName) === normalized(gameName) &&
        normalized(player.tagLine) === normalized(tagLine)
    )
    if (matching.length > 1) throw new Error('invalid-response')
    return matching[0] ?? null
  }

  async relationship(puuid: string, signal: AbortSignal): Promise<FriendTestRelationship> {
    const [rawFriends, rawRequests] = await Promise.all([
      this._request({ method: 'GET', url: '/lol-chat/v1/friends' }, signal),
      this._request({ method: 'GET', url: '/lol-chat/v2/friend-requests' }, signal)
    ])
    const friends = friendsSchema.safeParse(rawFriends)
    const requests = requestsSchema.safeParse(rawRequests)
    if (!friends.success || !requests.success) throw new Error('invalid-response')
    const matchingFriends = friends.data.filter((friend) => friend.puuid === puuid)
    const matchingRequests = requests.data.filter((request) => request.puuid === puuid)
    if (
      matchingFriends.length > 1 ||
      matchingRequests.length > 1 ||
      matchingFriends.some((friend) => !friend.id)
    ) {
      throw new Error('invalid-response')
    }
    return { friend: matchingFriends[0] ?? null, request: matchingRequests[0] ?? null }
  }

  async send(target: FriendRequestTestTarget, signal: AbortSignal) {
    await this._request(
      {
        method: 'POST',
        url: '/lol-chat/v2/friend-requests',
        data: {
          gameName: target.gameName,
          tagLine: target.tagLine,
          gameTag: target.tagLine,
          puuid: target.puuid
        }
      },
      signal
    )
  }

  async withdraw(puuid: string, signal: AbortSignal) {
    // v2 addresses requests by PUUID, not by the chat friend id used below.
    await this._request(
      { method: 'DELETE', url: `/lol-chat/v2/friend-requests/${encodeURIComponent(puuid)}` },
      signal
    )
  }

  async remove(id: string, signal: AbortSignal) {
    await this._request(
      { method: 'DELETE', url: `/lol-chat/v1/friends/${encodeURIComponent(id)}` },
      signal
    )
  }
}
