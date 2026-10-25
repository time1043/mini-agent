import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Assistant, ToolCallReviewer } from '../domain/roles.ts'
import { assistantMessage, userMessage } from '../domain/session.ts'
import type { Tool } from '../domain/tool.ts'
import { SessionNotFoundError } from './ports.ts'
import { AgentService } from './service.ts'
import { FakeTool, MemorySessionStore, ScriptedModelClient } from './testing.ts'

const aCall = { id: 'c1', toolName: 'fake', arguments: { query: 'x' } }
const allow = { shouldAllow: true, reason: null }
const deny = (reason: string | null) => ({ shouldAllow: false, reason })

const aService = (outputs: unknown[], tools: Tool[] = [], maxTurns = 4) => {
  const store = new MemorySessionStore()
  const service = new AgentService({
    modelClient: new ScriptedModelClient(outputs),
    sessionStore: store,
    assistant: new Assistant('指令', tools),
    reviewer: new ToolCallReviewer('审查'),
    assistantModelSettings: { modelId: 'assistant-model', effort: 'off' },
    reviewerModelSettings: { modelId: 'reviewer-model', effort: 'medium' },
    maxTurns,
  })
  return { service, store }
}

test('a reply without tool calls ends the loop', async () => {
  const { service, store } = aService([assistantMessage('你好')])
  const session = await service.newSession()

  const fresh = await service.chat(session.id, '在吗')

  assert.deepEqual(fresh, [userMessage('在吗'), assistantMessage('你好')])
  assert.deepEqual((await store.load(session.id)).messages, fresh)
})

test('onMessage receives every appended message', async () => {
  const { service } = aService([assistantMessage('你好')])
  const session = await service.newSession()

  const seen: string[] = []
  await service.chat(session.id, '在吗', (message) => seen.push(message.kind))

  assert.deepEqual(seen, ['user', 'assistant'])
})

test('an allowed tool call executes and its result is appended', async () => {
  const tool = new FakeTool('fake', 'fake-output')
  const { service, store } = aService([assistantMessage('跑一下', [aCall]), allow, assistantMessage('完成')], [tool])
  const session = await service.newSession()

  const fresh = await service.chat(session.id, '开始')

  assert.deepEqual(fresh, [
    userMessage('开始'),
    assistantMessage('跑一下', [aCall]),
    { kind: 'tool_result', toolCallId: 'c1', content: 'fake-output' },
    assistantMessage('完成'),
  ])
  assert.deepEqual(tool.calls, [{ query: 'x' }])
  assert.equal((await store.load(session.id)).messages.length, 4)
})

test('a rejected call never executes the tool', async () => {
  const tool = new FakeTool('fake', 'fake-output')
  const { service } = aService([assistantMessage('跑一下', [aCall]), deny('危险'), assistantMessage('好吧')], [tool])
  const session = await service.newSession()

  const fresh = await service.chat(session.id, '开始')

  assert.deepEqual(tool.calls, [])
  assert.deepEqual(fresh[2], { kind: 'tool_result', toolCallId: 'c1', content: '审查未通过：危险' })
})

test('a rejection without reason uses the fixed wording', async () => {
  const { service } = aService([assistantMessage('跑', [aCall]), deny(null), assistantMessage('好')])
  const session = await service.newSession()

  const fresh = await service.chat(session.id, '开始')

  assert.deepEqual(fresh[2], {
    kind: 'tool_result',
    toolCallId: 'c1',
    content: '审查未通过：审查员未提供理由',
  })
})

test('reviewer failure is fail-closed, not a crash', async () => {
  const { service } = aService([
    assistantMessage('跑一下', [aCall]),
    new Error('HTTP 503: reviewer down'),
    assistantMessage('完成'),
  ])
  const session = await service.newSession()

  const fresh = await service.chat(session.id, '开始')

  assert.deepEqual(fresh[2], { kind: 'tool_result', toolCallId: 'c1', content: '审查未通过：审查员不可用' })
  assert.deepEqual(fresh[3], assistantMessage('完成'))
})

test('an unknown tool becomes an error result', async () => {
  const { service } = aService([
    assistantMessage('跑一下', [{ ...aCall, toolName: 'nope' }]),
    allow,
    assistantMessage('完成'),
  ])
  const session = await service.newSession()

  const fresh = await service.chat(session.id, '开始')

  assert.deepEqual(fresh[2], { kind: 'tool_result', toolCallId: 'c1', content: 'error: unknown tool: nope' })
})

test('a tool exception becomes an error result', async () => {
  const boom: Tool = {
    name: 'boom',
    description: '',
    parameters: {},
    execute: async () => {
      throw new Error('炸了')
    },
  }
  const { service } = aService([assistantMessage('跑一下', [{ ...aCall, toolName: 'boom' }]), allow, assistantMessage('完成')], [boom])
  const session = await service.newSession()

  const fresh = await service.chat(session.id, '开始')

  assert.deepEqual(fresh[2], { kind: 'tool_result', toolCallId: 'c1', content: 'error: 炸了' })
})

test('maxTurns caps assistant invocations', async () => {
  const tool = new FakeTool('fake', 'out')
  const { service } = aService(
    [assistantMessage('a', [aCall]), allow, assistantMessage('b', [aCall]), allow],
    [tool],
    2,
  )
  const session = await service.newSession()

  const fresh = await service.chat(session.id, '开始')

  assert.equal(tool.calls.length, 2)
  assert.equal(fresh.length, 5)
})

test('chat on a missing session rejects with SessionNotFoundError', async () => {
  const { service } = aService([])
  await assert.rejects(service.chat('nope', 'x'), SessionNotFoundError)
})

test('the user message is persisted before the first model call', async () => {
  const { service, store } = aService([new Error('HTTP 500: assistant down')])
  const session = await service.newSession()

  await assert.rejects(service.chat(session.id, '重要的话'), /HTTP 500/)

  const persisted = store.snapshots.filter((snapshot) => snapshot.id === session.id)
  assert.equal(persisted.length, 2)
  assert.deepEqual(persisted[0].messages, [])
  assert.deepEqual(persisted[1].messages, [userMessage('重要的话')])
})

test('listSessions returns every saved session', async () => {
  const { service } = aService([])
  await service.newSession()
  await service.newSession()

  assert.equal((await service.listSessions()).length, 2)
})
