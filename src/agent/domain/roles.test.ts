import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decodeDecision, decisionOutput } from './roles.ts'
import { Assistant, ToolCallReviewer } from './roles.ts'
import { Session, toolResult, userMessage } from './session.ts'
import type { ToolCall } from './session.ts'

test('decodeDecision accepts valid payloads and defaults reason to null', () => {
  assert.deepEqual(decodeDecision({ should_allow: true }), { shouldAllow: true, reason: null })
  assert.deepEqual(decodeDecision({ should_allow: false, reason: null }), { shouldAllow: false, reason: null })
  assert.deepEqual(decodeDecision({ should_allow: false, reason: '危险' }), { shouldAllow: false, reason: '危险' })
})

test('decodeDecision rejects non-boolean should_allow and bad reason', () => {
  assert.throws(() => decodeDecision({ should_allow: 'false' }))
  assert.throws(() => decodeDecision({ should_allow: 1 }))
  assert.throws(() => decodeDecision({}))
  assert.throws(() => decodeDecision({ should_allow: true, reason: 3 }))
  assert.throws(() => decodeDecision('yes'))
  assert.throws(() => decodeDecision(null))
  assert.throws(() => decodeDecision([true]))
})

test('decision output codec is json with a snake_case hint', () => {
  assert.equal(decisionOutput.kind, 'json')
  assert.match(decisionOutput.jsonHint, /should_allow/)
})

test('assistant context snapshots session messages', () => {
  const session = Session.create()
  session.append(userMessage('第一句'))
  const assistant = new Assistant('指令', [])
  const context = assistant.context(session)
  session.append(userMessage('后追加的'))
  assert.deepEqual(context.messages, [userMessage('第一句')])
  assert.equal(context.instruction, '指令')
  assert.deepEqual(context.tools, [])
})

test('reviewer context holds the last user message and the pending call', () => {
  const session = Session.create()
  session.append(userMessage('删掉刚建的文件'))
  const call: ToolCall = { id: 'c1', toolName: 'bash', arguments: { command: 'rm file' } }
  const context = new ToolCallReviewer('审查').context(session, call)
  assert.equal(context.messages.length, 2)
  assert.deepEqual(context.messages[0], userMessage('删掉刚建的文件'))
  assert.deepEqual(JSON.parse(context.messages[1].kind === 'user' ? context.messages[1].text : ''), {
    tool: 'bash',
    arguments: { command: 'rm file' },
  })
  assert.equal(context.output.kind, 'json')
})

test('reviewer context without any user message still carries the call', () => {
  const session = Session.create()
  session.append(toolResult('c9', '孤儿结果'))
  const context = new ToolCallReviewer('审查').context(session, {
    id: 'c1',
    toolName: 'bash',
    arguments: {},
  })
  assert.equal(context.messages.length, 1)
})
