import axios, { type AxiosInstance, type AxiosResponse, type CreateAxiosDefaults } from 'axios'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import type { NetworkSession } from './context'

type AxiosFetch = NonNullable<NonNullable<CreateAxiosDefaults['env']>['fetch']>

function normalizeResponse(response: AxiosResponse) {
  // Chromium already decodes compressed responses. Forwarding the wire encoding/length
  // through akari:// would describe a different body to the renderer.
  if (response.headers['content-encoding']) {
    delete response.headers['content-encoding']
    delete response.headers['content-length']
  }
  if (response.config.responseType === 'stream' && response.data) {
    response.data = Readable.fromWeb(response.data as NodeReadableStream, {
      signal: response.config.signal as AbortSignal | undefined
    })
  } else if (
    response.config.responseType === 'arraybuffer' &&
    response.data instanceof ArrayBuffer
  ) {
    response.data = Buffer.from(response.data)
  }
  return response
}

export function createNetworkAxiosClient(
  electronSession: NetworkSession,
  waitUntilConfigured: () => Promise<void>,
  defaults: CreateAxiosDefaults = {}
): AxiosInstance {
  const electronFetch: AxiosFetch = async (input, init) => {
    await waitUntilConfigured()
    return electronSession.fetch(input instanceof URL ? input.toString() : input, init)
  }

  const client = axios.create({
    ...defaults,
    adapter: 'fetch',
    env: {
      ...defaults.env,
      fetch: electronFetch
    }
  })
  client.interceptors.response.use(normalizeResponse, (error) => {
    if (axios.isAxiosError(error) && error.response) normalizeResponse(error.response)
    return Promise.reject(error)
  })
  return client
}
