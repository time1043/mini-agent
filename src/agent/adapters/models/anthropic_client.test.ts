import assert from 'node:assert/strict'
import { test } from 'node:test'

import { jsonOutput } from '../../domain/context.ts'
import { assistantMessage, toolResult, userMessage } from '../../domain/session.ts'
import { AnthropicModelClient, toEntries } from './anthropic_client.ts'

const assistantPayload = {
  content: [
    { type: 'text', text: '我来跑命令' },
    { type: 'tool_use', id: 'tu_1', name: 'bash', input: { command: 'ls' } },
  ],
}

const aClient = (payload: unknown) => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(payload), { status: 200 })
  }) as typeof fetch
  const client = new AnthropicModelClient({ baseUrl: 'https://api.test/', apiKey: 'k', fetchImpl })
  return { calls, client }
}

const assistantCodec = { kind: 'assistant', decode: (reply: unknown) => reply } as const

test('assistant codec reads text and tool_use blocks', async () => {
  const { client, calls } = aClient(assistantPayload)

  const reply = await client.generate(
    { instruction: '指令', tools: [], messages: [userMessage('看看目录')], output: assistantCodec },
    { modelId: 'claude', effort: 'off' },
  )

  assert.deepEqual(reply, assistantMessage('我来跑命令', [
    { id: 'tu_1', toolName: 'bash', arguments: { command: 'ls' } },
  ]))
  assert.equal(calls[0].url, 'https://api.test/v1/messages')
  const headers = calls[0].init.headers as Record<string, string>
  assert.equal(headers['x-api-key'], 'k')
  assert.equal(headers['anthropic-version'], '2023-06-01')
  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.equal(body['max_tokens'], 4096)
  assert.equal(body['system'], '指令')
  assert.equal('output_config' in body, false)
})

test('tools map to input_schema and effort maps to output_config', async () => {
  const { client, calls } = aClient(assistantPayload)

  await client.generate(
    {
      instruction: '指令',
      tools: [
        { name: 'bash', description: '执行', parameters: { type: 'object', properties: {} }, execute: async () => '' },
      ],
      messages: [],
      output: assistantCodec,
    },
    { modelId: 'claude', effort: 'high' },
  )

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.deepEqual(body['tools'], [
    { name: 'bash', description: '执行', input_schema: { type: 'object', properties: {} } },
  ])
  assert.deepEqual(body['output_config'], { effort: 'high' })
})

test('json codec decodes from text blocks', async () => {
  const { client } = aClient({ content: [{ type: 'text', text: '{"should_allow":false,"reason":"危险"}' }] })
  const codec = jsonOutput('"should_allow": boolean', (value) => value as { should_allow: boolean })

  const decision = await client.generate(
    { instruction: '审查', tools: [], messages: [], output: codec },
    { modelId: 'claude', effort: 'off' },
  )

  assert.deepEqual(decision, { should_allow: false, reason: '危险' })
})

test('rendering keeps roles alternating and merges adjacent user blocks', () => {
  const entries = toEntries([
    userMessage('删掉临时文件'),
    assistantMessage('好的', [{ id: 't1', toolName: 'bash', arguments: {} }]),
    toolResult('t1', 'done'),
    toolResult('t1', 'again'),
    userMessage('继续'),
    assistantMessage(''),
  ])

  assert.deepEqual(entries, [
    { role: 'user', content: [{ type: 'text', text: '删掉临时文件' }] },
    {
      role: 'assistant',
      content: [
        { type: 'text', text: '好的' },
        { type: 'tool_use', id: 't1', name: 'bash', input: {} },
      ],
    },
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'done' },
        { type: 'tool_result', tool_use_id: 't1', content: 'again' },
        { type: 'text', text: '继续' },
      ],
    },
    { role: 'assistant', content: [{ type: 'text', text: '(no content)' }] },
  ])
})
