import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  Session,
  assistantMessage,
  isSessionId,
  messageFromJSON,
  messageToJSON,
  toolResult,
  userMessage,
} from './session.ts'

const aToolCall = { id: 'c1', toolName: 'bash', arguments: { command: 'ls' } }

const aSessionJSON = () => ({
  version: 1,
  id: '20261025-142301-9a3b7c1d',
  messages: [
    { kind: 'user', text: '看看目录' },
    { kind: 'assistant', text: '好的', toolCalls: [aToolCall] },
    { kind: 'tool_result', toolCallId: 'c1', content: 'exit_code: 0\n\n.' },
  ],
})

test('message factories produce discriminated unions', () => {
  assert.deepEqual(userMessage('hi'), { kind: 'user', text: 'hi' })
  assert.deepEqual(assistantMessage('ok'), { kind: 'assistant', text: 'ok', toolCalls: [] })
  assert.deepEqual(assistantMessage('ok', [aToolCall]), {
    kind: 'assistant',
    text: 'ok',
    toolCalls: [aToolCall],
  })
  assert.deepEqual(toolResult('c1', 'out'), {
    kind: 'tool_result',
    toolCallId: 'c1',
    content: 'out',
  })
})

test('message json roundtrip keeps all kinds', () => {
  const messages = [userMessage('hi'), assistantMessage('', [aToolCall]), toolResult('c1', 'out')]
  for (const message of messages) {
    assert.deepEqual(messageFromJSON(JSON.parse(JSON.stringify(messageToJSON(message)))), message)
  }
})

test('messageFromJSON rejects malformed data', () => {
  assert.throws(() => messageFromJSON(null))
  assert.throws(() => messageFromJSON('nope'))
  assert.throws(() => messageFromJSON({ kind: 'nope' }))
  assert.throws(() => messageFromJSON({ kind: 'user' }))
  assert.throws(() => messageFromJSON({ kind: 'user', text: 1 }))
  assert.throws(() => messageFromJSON({ kind: 'assistant', text: 'x', toolCalls: 'no' }))
  assert.throws(() => messageFromJSON({ kind: 'assistant', text: 'x', toolCalls: [{ id: 'c' }] }))
  assert.throws(() =>
    messageFromJSON({ kind: 'assistant', text: 'x', toolCalls: [{ ...aToolCall, arguments: 3 }] }),
  )
  assert.throws(() => messageFromJSON({ kind: 'tool_result', toolCallId: 'c1' }))
})

test('session create makes sortable ids with random suffix', () => {
  const fixed = new Date(2026, 9, 25, 14, 23, 1)
  assert.match(Session.create(fixed).id, /^20261025-142301-[0-9a-f]{8}$/)
  assert.ok(isSessionId(Session.create().id))
})

test('session append grows the readonly message view', () => {
  const session = Session.create()
  session.append(userMessage('hi'))
  session.append(assistantMessage('ok'))
  assert.equal(session.messages.length, 2)
  assert.deepEqual([...session.messages], [userMessage('hi'), assistantMessage('ok')])
})

test('session json roundtrip', () => {
  const session = Session.create(new Date(2026, 9, 25, 14, 23, 1))
  session.append(userMessage('hi'))
  session.append(assistantMessage('run', [aToolCall]))
  session.append(toolResult('c1', 'out'))

  const restored = Session.fromJSON(JSON.parse(JSON.stringify(session)))
  assert.equal(restored.id, session.id)
  assert.deepEqual(restored.messages, session.messages)
})

test('session fromJSON rejects malformed envelopes', () => {
  assert.throws(() => Session.fromJSON(null))
  assert.throws(() => Session.fromJSON({ version: 2, id: 'x', messages: [] }))
  assert.throws(() => Session.fromJSON({ version: 1, messages: [] }))
  assert.throws(() => Session.fromJSON({ version: 1, id: 'x' }))
  assert.throws(() => Session.fromJSON({ version: 1, id: 'x', messages: 'no' }))
  assert.throws(() => Session.fromJSON({ version: 1, id: 'x', messages: [{ kind: 'nope' }] }))
})
