import type { IncomingMessage, Server, ServerResponse } from 'node:http'

/**
 * Web API 适配器：把 AgentService 暴露为 HTTP 接口（node:http，零依赖）。
 * 路由：
 * - POST /sessions                → 201 {"id": ...}
 * - GET  /sessions                → [{"id": ..., "messageCount": ...}]
 * - POST /sessions/{id}/messages  → {"messages": [...]}；body 为 {"text": string}
 * SessionNotFoundError 是唯一的 404 来源；其余错误统一 500 且不泄露内部细节。
 */
import { createServer } from 'node:http'

import { SessionNotFoundError } from '../../app/ports.ts'
import { AgentService } from '../../app/service.ts'
import { messageToJSON } from '../../domain/session.ts'

const MAX_BODY_BYTES = 1_000_000

class BodyTooLargeError extends Error {}

export function createApp(service: AgentService): Server {
  return createServer((request, response) => {
    void handle(request, response)
  })

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      await route(request, response)
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        // 不主动 destroy 请求：提前响应后由 Node 关闭未消费完的连接，避免客户端收到 RST。
        send(response, 413, { error: 'body too large' })
        return
      }
      if (error instanceof SessionNotFoundError) {
        send(response, 404, { error: 'session not found' })
        return
      }
      console.error('[mini-agent] internal error:', error)
      if (response.headersSent) response.end()
      else send(response, 500, { error: 'internal error' })
    }
  }

  async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url ?? '/', 'http://localhost')
    const segments = url.pathname.replace(/\/+$/, '').split('/').filter(Boolean)
    const method = request.method ?? 'GET'

    if (segments.length === 1 && segments[0] === 'sessions') {
      if (method === 'POST') {
        const body = await readBody(request)
        if (body !== null && Object.keys(body).length > 0) {
          send(response, 400, { error: 'POST /sessions takes no body' })
          return
        }
        const session = await service.newSession()
        send(response, 201, { id: session.id })
        return
      }
      if (method === 'GET') {
        const sessions = await service.listSessions()
        send(
          response,
          200,
          sessions.map((session) => ({ id: session.id, messageCount: session.messages.length })),
        )
        return
      }
      send(response, 405, { error: 'method not allowed' })
      return
    }

    if (segments.length === 3 && segments[0] === 'sessions' && segments[2] === 'messages') {
      if (method !== 'POST') {
        send(response, 405, { error: 'method not allowed' })
        return
      }
      const body = await readBody(request)
      const text = body?.['text']
      if (typeof text !== 'string') {
        send(response, 400, { error: 'body must be {"text": string}' })
        return
      }
      const fresh = await service.chat(segments[1], text)
      send(response, 200, { messages: fresh.map(messageToJSON) })
      return
    }

    send(response, 404, { error: 'not found' })
  }
}

/** null 表示 body 缺失或不是合法 JSON，由调用方决定 400。 */
function readBody(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const declared = Number(request.headers['content-length'] ?? '0')
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      request.pause()
      reject(new BodyTooLargeError())
      return
    }
    const chunks: Buffer[] = []
    let received = 0
    request.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_BODY_BYTES) {
        request.pause()
        reject(new BodyTooLargeError())
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8')
      if (text === '') {
        resolve(null)
        return
      }
      try {
        const parsed: unknown = JSON.parse(text)
        resolve(
          parsed !== null && typeof parsed === 'object'
            ? (parsed as Record<string, unknown>)
            : null,
        )
      } catch {
        resolve(null)
      }
    })
    request.on('error', reject)
  })
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

export class WebApi {
  #service: AgentService

  constructor(service: AgentService) {
    this.#service = service
  }

  async run(host = '127.0.0.1', port = 3000): Promise<Server> {
    const server = createApp(this.#service)
    await new Promise<void>((resolve) => server.listen(port, host, resolve))
    return server
  }
}
