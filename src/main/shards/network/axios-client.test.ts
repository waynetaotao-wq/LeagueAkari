import axios from 'axios'
import { once } from 'node:events'
import { type RequestListener, type Server, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'

import { createNetworkAxiosClient } from './axios-client'
import type { NetworkSession } from './context'

const servers: Server[] = []

async function serve(handler: RequestListener) {
  const server = createServer(handler)
  servers.push(server)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

// Exercise real HTTP through the fetch adapter. Electron Session/proxy behavior is
// checked separately in the runtime smoke; Node fetch cannot validate Chromium.
function client(configured = Promise.resolve()) {
  return createNetworkAxiosClient(
    { fetch: fetch as NetworkSession['fetch'] } as NetworkSession,
    () => configured,
    { timeout: 2_000 }
  )
}

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => {
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      )
    })
  )
})

describe('application HTTP response contracts', () => {
  it('waits for proxy configuration before making a data-source request', async () => {
    let requests = 0
    const url = await serve((_request, response) => {
      requests++
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ championId: 238 }))
    })
    let configured!: () => void
    const gate = new Promise<void>((resolve) => {
      configured = resolve
    })
    const pending = client(gate).get(url)
    await new Promise((resolve) => setImmediate(resolve))
    expect(requests).toBe(0)

    configured()

    expect((await pending).data).toEqual({ championId: 238 })
    expect(requests).toBe(1)
  })

  it('returns decoded JSON without wire compression headers when forwarding through akari', async () => {
    const bytes = gzipSync(JSON.stringify({ gameId: 123, participants: [{ championId: 238 }] }))
    const url = await serve((_request, response) => {
      response.writeHead(200, {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': bytes.length
      })
      response.end(bytes)
    })

    const response = await client().get(url)

    expect(response.data).toEqual({ gameId: 123, participants: [{ championId: 238 }] })
    expect(response.headers['content-encoding']).toBeUndefined()
    expect(response.headers['content-length']).toBeUndefined()
  })

  it('preserves binary workbook and image bytes as a Node buffer', async () => {
    const bytes = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0xff, 0x80, 0x0a])
    const url = await serve((_request, response) => {
      response.setHeader('content-type', 'application/octet-stream')
      response.end(bytes)
    })

    const response = await client().get(url, { responseType: 'arraybuffer' })

    expect(Buffer.isBuffer(response.data)).toBe(true)
    expect(response.data).toEqual(bytes)
  })

  it('provides a Node readable stream for resource and updater downloads', async () => {
    const bytes = Buffer.from('downloaded resource')
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-encoding': 'gzip' })
      response.end(gzipSync(bytes))
    })

    const response = await client().get(url, { responseType: 'stream' })
    expect(response.data).toBeInstanceOf(Readable)
    const chunks: Buffer[] = []
    for await (const chunk of response.data) chunks.push(Buffer.from(chunk))
    expect(Buffer.concat(chunks)).toEqual(bytes)
    expect(response.headers['content-encoding']).toBeUndefined()
  })

  it('retains response status/body for failures and honors request cancellation', async () => {
    const started = Promise.withResolvers<void>()
    const url = await serve((request, response) => {
      if (request.url === '/slow') {
        started.resolve()
        return
      }
      response.writeHead(403, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ message: 'unavailable' }))
    })
    await expect(client().get(url)).rejects.toMatchObject({
      response: { status: 403, data: { message: 'unavailable' } }
    })

    const abort = new AbortController()
    const pending = client().get(url + '/slow', { signal: abort.signal })
    const canceled = pending.catch((error) => error)
    await started.promise
    abort.abort()
    expect(axios.isCancel(await canceled)).toBe(true)
  })
})
