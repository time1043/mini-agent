import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { AddressInfo } from 'node:net'

import { Assistant, ToolCallReviewer } from '../../domain/roles.ts'
import { assistantMessage } from '../../domain/session.ts'
import type { SessionStore } from '../../app/ports.ts'
import { AgentService } from '../../app/service.ts'
import { MemorySessionStore, ScriptedModelClient } from '../../app/testing.ts'
import { createApp } from './web.ts'

const aServer = async (t: import('node:test').TestContext, outputs: unknown[] = [assistantMessage('你好')]) => {
  const store: SessionStore = new MemorySessionStore()
  const service = new AgentService({
    modelClient: new ScriptedModelClient(outputs),
    sessionStore: store,
    assistant: new Assistant('指令'),
    reviewer: new ToolCallReviewer('审查'),
    assistantModelSettings: { modelId: 'm', effort: 'off' },
    reviewerModelSettings: { modelId: 'm', effort: 'off' },
    maxTurns: 2,
  })
  const server = createApp(service)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  t.after(() => server.close())
  return { base: `http://127.0.0.1:${port}`, store, service }
}

test('POST /sessions creates a session', async (t) => {
  const { base, store } = await aServer(t)

  const response = await fetch(`${base}/sessions`, { method: 'POST' })

  assert.equal(response.status, 201)
  const body = (await response.json()) as { id: string }
  assert.match(body.id, /^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$/)
  assert.deepEqual((await store.list()).map((session) => session.id), [body.id])
})

test('GET /sessions lists sessions with message counts', async (t) => {
  const { base, service } = await aServer(t)
  const session = await service.newSession()

  const response = await fetch(`${base}/sessions`)

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), [{ id: session.id, messageCount: 0 }])
})

test('POST messages runs a chat turn', async (t) => {
  const { base, service } = await aServer(t)
  const session = await (async () => {
    const created = await fetch(`${base}/sessions`, { method: 'POST' })
    return (await created.json()) as { id: string }
  })()

  const response = await fetch(`${base}/sessions/${session.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '在吗' }),
  })

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    messages: [
      { kind: 'user', text: '在吗' },
      { kind: 'assistant', text: '你好', toolCalls: [] },
    ],
  })
  const persisted = await service.loadSession(session.id)
  assert.equal(persisted.messages.length, 2)
})

test('unknown session maps to 404 and nothing else pretends to be it', async (t) => {
  const { base } = await aServer(t)

  const response = await fetch(`${base}/sessions/20260101-000000-aaaaaaaa/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'hi' }),
  })

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'session not found' })
})

test('malformed bodies map to 400', async (t) => {
  const { base, service } = await aServer(t)
  const session = await service.newSession()

  const broken = await fetch(`${base}/sessions/${session.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  })
  assert.equal(broken.status, 400)

  const missingText = await fetch(`${base}/sessions/${session.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wrong: 1 }),
  })
  assert.equal(missingText.status, 400)
})

test('routing rejects unknown paths and wrong methods', async (t) => {
  const { base, service } = await aServer(t)
  const session = await service.newSession()

  assert.equal((await fetch(`${base}/nope`)).status, 404)
  assert.equal((await fetch(`${base}/sessions/${session.id}/messages/extra`, { method: 'POST' })).status, 404)
  assert.equal((await fetch(`${base}/sessions/${session.id}/messages`)).status, 405)
  assert.equal((await fetch(`${base}/sessions`, { method: 'DELETE' })).status, 405)
  assert.equal((await fetch(`${base}/sessions/`, { method: 'POST' })).status, 201)
})

test('oversized bodies map to 413', async (t) => {
  const { base, service } = await aServer(t)
  const session = await service.newSession()

  const response = await fetch(`${base}/sessions/${session.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: 'x'.repeat(1_200_000) }),
  })

  assert.equal(response.status, 413)
  assert.deepEqual(await response.json(), { error: 'body too large' })
})
