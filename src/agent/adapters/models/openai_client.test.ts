import assert from 'node:assert/strict'
import { test } from 'node:test'

import { jsonOutput } from '../../domain/context.ts'
import { assistantMessage, toolResult, userMessage } from '../../domain/session.ts'
import { OpenAIModelClient } from './openai_client.ts'

interface Capture {
  url: string
  init: RequestInit
}

const capturingFetch = (payload: unknown) => {
  const calls: Capture[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(payload), { status: 200 })
  }) as typeof fetch
  return { calls, fetchImpl }
}

const aClient = (payload: unknown) => {
  const { calls, fetchImpl } = capturingFetch(payload)
  const client = new OpenAIModelClient({
    baseUrl: 'https://api.test/',
    apiKey: 'k-secret',
    fetchImpl,
  })
  return { calls, client }
}

const assistantPayload = {
  choices: [
    {
      message: {
        content: '我来看看',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } },
          { id: 'c2', type: 'function', function: { name: 'bash', arguments: 'not json' } },
        ],
      },
    },
  ],
}

test('assistant codec maps native tool calls', async () => {
  const { client, calls } = aClient(assistantPayload)

  const reply = await client.generate(
    {
      instruction: '指令',
      tools: [],
      messages: [userMessage('看看目录')],
      output: { kind: 'assistant', decode: (r) => r },
    },
    { modelId: 'deepseek-flash', effort: 'off' },
  )

  assert.deepEqual(
    reply,
    assistantMessage('我来看看', [
      { id: 'c1', toolName: 'bash', arguments: { command: 'ls' } },
      { id: 'c2', toolName: 'bash', arguments: {} },
    ]),
  )
  assert.equal(calls[0].url, 'https://api.test/chat/completions')
  const headers = calls[0].init.headers as Record<string, string>
  assert.equal(headers['authorization'], 'Bearer k-secret')
  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.equal(body['model'], 'deepseek-flash')
  assert.equal('reasoning_effort' in body, false)
  assert.deepEqual(body['messages'], [
    { role: 'system', content: '指令' },
    { role: 'user', content: '看看目录' },
  ])
})

test('tools and effort are only sent when present', async () => {
  const { client, calls } = aClient(assistantPayload)

  await client.generate(
    {
      instruction: '指令',
      tools: [
        {
          name: 'bash',
          description: '执行',
          parameters: { type: 'object', properties: {} },
          execute: async () => '',
        },
      ],
      messages: [],
      output: { kind: 'assistant', decode: (r) => r },
    },
    { modelId: 'm', effort: 'low' },
  )

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.deepEqual(body['tools'], [
    {
      type: 'function',
      function: {
        name: 'bash',
        description: '执行',
        parameters: { type: 'object', properties: {} },
      },
    },
  ])
  assert.equal(body['reasoning_effort'], 'low')
})

test('history entries map all message kinds', async () => {
  const { client, calls } = aClient(assistantPayload)

  await client.generate(
    {
      instruction: '指令',
      tools: [],
      messages: [
        userMessage('q'),
        assistantMessage('a', [{ id: 'c1', toolName: 'bash', arguments: { command: 'ls' } }]),
        toolResult('c1', 'out'),
      ],
      output: { kind: 'assistant', decode: (r) => r },
    },
    { modelId: 'm', effort: 'off' },
  )

  const body = JSON.parse(String(calls[0].init.body)) as { messages: Record<string, unknown>[] }
  assert.deepEqual(body['messages'], [
    { role: 'system', content: '指令' },
    { role: 'user', content: 'q' },
    {
      role: 'assistant',
      content: 'a',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'bash', arguments: '{"command":"ls"}' } },
      ],
    },
    { role: 'tool', tool_call_id: 'c1', content: 'out' },
  ])
})

test('json codec asks for json and decodes the reply', async () => {
  const { client, calls } = aClient({
    choices: [{ message: { content: '```json\n{"v":3}\n```' } }],
  })
  const codec = jsonOutput<{ v: number }>('"v": number', (value) => value as { v: number })

  const decoded = await client.generate(
    { instruction: '指令', tools: [], messages: [], output: codec },
    { modelId: 'm', effort: 'off' },
  )

  assert.deepEqual(decoded, { v: 3 })
  const body = JSON.parse(String(calls[0].init.body)) as { messages: { content: string }[] }
  assert.match(body['messages'][0].content, /只输出一个 JSON 对象/)
  assert.match(body['messages'][0].content, /"v": number/)
})

test('http errors and malformed responses become ModelError', async () => {
  const failing = (async () => new Response('quota', { status: 429 })) as typeof fetch
  const client = new OpenAIModelClient({
    baseUrl: 'https://api.test',
    apiKey: 'k',
    fetchImpl: failing,
  })

  await assert.rejects(
    client.generate(
      {
        instruction: 'x',
        tools: [],
        messages: [],
        output: { kind: 'assistant', decode: (r) => r },
      },
      { modelId: 'm', effort: 'off' },
    ),
    /HTTP 429: quota/,
  )

  const { client: broken } = aClient({ unexpected: true })
  await assert.rejects(
    broken.generate(
      {
        instruction: 'x',
        tools: [],
        messages: [],
        output: { kind: 'assistant', decode: (r) => r },
      },
      { modelId: 'm', effort: 'off' },
    ),
    /unexpected response shape/,
  )
})
