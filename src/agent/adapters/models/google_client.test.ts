import assert from 'node:assert/strict'
import { test } from 'node:test'

import { jsonOutput } from '../../domain/context.ts'
import { assistantMessage, toolResult, userMessage } from '../../domain/session.ts'
import { GoogleModelClient, toContents } from './google_client.ts'

const assistantPayload = {
  candidates: [
    {
      content: {
        parts: [{ text: '我来执行' }, { functionCall: { name: 'bash', args: { command: 'ls' } } }],
      },
    },
  ],
}

const aClient = (payload: unknown) => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify(payload), { status: 200 })
  }) as typeof fetch
  const client = new GoogleModelClient({ baseUrl: 'https://g.test/', apiKey: 'k', fetchImpl })
  return { calls, client }
}

const assistantCodec = { kind: 'assistant', decode: (reply: unknown) => reply } as const

test('assistant codec synthesizes call ids in order', async () => {
  const { client, calls } = aClient(assistantPayload)

  const reply = await client.generate(
    { instruction: '指令', tools: [], messages: [userMessage('看看目录')], output: assistantCodec },
    { modelId: 'gemini', effort: 'off' },
  )

  assert.deepEqual(
    reply,
    assistantMessage('我来执行', [
      { id: 'call_0', toolName: 'bash', arguments: { command: 'ls' } },
    ]),
  )
  assert.equal(calls[0].url, 'https://g.test/v1beta/models/gemini:generateContent')
  const headers = calls[0].init.headers as Record<string, string>
  assert.equal(headers['x-goog-api-key'], 'k')
  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.deepEqual(body['systemInstruction'], { parts: [{ text: '指令' }] })
  assert.equal('generationConfig' in body, false)
})

test('effort maps to thinkingConfig and tools to functionDeclarations', async () => {
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
      output: assistantCodec,
    },
    { modelId: 'gemini', effort: 'xhigh' },
  )

  const body = JSON.parse(String(calls[0].init.body)) as Record<string, unknown>
  assert.deepEqual(body['generationConfig'], { thinkingConfig: { thinkingLevel: 'xhigh' } })
  assert.deepEqual(body['tools'], [
    {
      functionDeclarations: [
        { name: 'bash', description: '执行', parameters: { type: 'object', properties: {} } },
      ],
    },
  ])
})

test('json codec decodes from text parts', async () => {
  const { client } = aClient({ candidates: [{ content: { parts: [{ text: '{"v":9}' }] } }] })
  const codec = jsonOutput<{ v: number }>('"v": number', (value) => value as { v: number })

  const decoded = await client.generate(
    { instruction: '指令', tools: [], messages: [], output: codec },
    { modelId: 'gemini', effort: 'off' },
  )

  assert.deepEqual(decoded, { v: 9 })
})

test('rendering maps functionCall/functionResponse and tolerates orphans', () => {
  const contents = toContents([
    userMessage('跑一下'),
    assistantMessage('好', [
      { id: 'call_0', toolName: 'bash', arguments: { command: 'ls' } },
      { id: 'call_1', toolName: 'pwd', arguments: {} },
    ]),
    toolResult('call_0', 'out0'),
    toolResult('call_1', 'out1'),
    toolResult('call_lost', '孤儿'),
    assistantMessage(''),
  ])

  assert.deepEqual(contents, [
    { role: 'user', parts: [{ text: '跑一下' }] },
    {
      role: 'model',
      parts: [
        { text: '好' },
        { functionCall: { name: 'bash', args: { command: 'ls' } } },
        { functionCall: { name: 'pwd', args: {} } },
      ],
    },
    {
      role: 'user',
      parts: [
        { functionResponse: { name: 'bash', response: { result: 'out0' } } },
        { functionResponse: { name: 'pwd', response: { result: 'out1' } } },
        { functionResponse: { name: 'call_lost', response: { result: '孤儿' } } },
      ],
    },
    { role: 'model', parts: [{ text: '(no content)' }] },
  ])
})
