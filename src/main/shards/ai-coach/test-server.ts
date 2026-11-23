import { type IncomingMessage, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface RecordedRequest {
  method: string
  url: string
  headers: IncomingMessage['headers']
  body: string
}

export type TestServerHandler = (
  request: RecordedRequest,
  response: ServerResponse
) => void | Promise<void>

/**
 * A provider stand-in for tests: a real HTTP server on this computer, so the request goes
 * through the same client code, headers and stream handling as a real one.
 */
export async function startTestServer(handler: TestServerHandler) {
  const requests: RecordedRequest[] = []
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk))
    incoming.on('end', () => {
      const request = {
        method: incoming.method ?? '',
        url: incoming.url ?? '',
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString('utf8')
      }
      requests.push(request)
      void handler(request, response)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

/** An address nothing listens on: a server is started to get a free port, then stopped. */
export async function findUnusedAddress() {
  const server = await startTestServer(() => {})
  await server.close()
  return server.url
}

export interface SseEvent {
  event?: string
  data: unknown
}

export function formatSse(events: SseEvent[]) {
  return events
    .map(({ event, data }) => {
      const payload = typeof data === 'string' ? data : JSON.stringify(data)
      return `${event ? `event: ${event}\n` : ''}data: ${payload}\n\n`
    })
    .join('')
}

/** Answers with a complete event stream. */
export function sendSse(response: ServerResponse, events: SseEvent[], status = 200) {
  response.writeHead(status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  response.end(formatSse(events))
}

export function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) {
  response.writeHead(status, { 'content-type': 'application/json', ...headers })
  response.end(typeof body === 'string' ? body : JSON.stringify(body))
}

export const wait = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
