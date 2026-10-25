import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ModelError } from '../../app/ports.ts'
import { jsonOutput } from '../../domain/context.ts'
import { appendJsonHint, extractJson, postJson } from './common.ts'

test('appendJsonHint only touches json codecs', () => {
  const assistantLike = { kind: 'assistant', decode: (reply: unknown) => reply } as const
  assert.equal(appendJsonHint('指令', assistantLike), '指令')

  const codec = jsonOutput('"n": number', (value) => value)
  const hinted = appendJsonHint('指令', codec)
  assert.match(hinted, /^指令\n\n/)
  assert.match(hinted, /只输出一个 JSON 对象/)
  assert.match(hinted, /"n": number/)
})

test('extractJson handles fenced and embedded json', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 })
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 })
  assert.deepEqual(extractJson('结果如下：{"a":{"b":2}} 请查收'), { a: { b: 2 } })
})

test('extractJson raises ModelError on garbage', () => {
  assert.throws(() => extractJson('no braces here'), ModelError)
  assert.throws(() => extractJson('{"a":'), ModelError)
})

test('postJson posts json and parses the response', async () => {
  const calls: { url: string; init: RequestInit }[] = []
  const fetchImpl = (async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    return new Response(JSON.stringify({ ok: 1 }), { status: 200 })
  }) as typeof fetch

  const result = await postJson({
    url: 'https://x.test/v1',
    headers: { authorization: 'Bearer k' },
    body: { model: 'm' },
    fetchImpl,
    timeoutMs: 1000,
  })

  assert.deepEqual(result, { ok: 1 })
  assert.equal(calls[0].url, 'https://x.test/v1')
  assert.equal(calls[0].init.method, 'POST')
  const headers = calls[0].init.headers as Record<string, string>
  assert.equal(headers['content-type'], 'application/json')
  assert.equal(headers['authorization'], 'Bearer k')
  assert.deepEqual(JSON.parse(String(calls[0].init.body)), { model: 'm' })
})

test('postJson folds http errors, network errors and bad bodies into ModelError', async () => {
  const httpError = (async () => new Response('boom', { status: 500 })) as typeof fetch
  await assert.rejects(
    postJson({ url: 'u', headers: {}, body: {}, fetchImpl: httpError, timeoutMs: 1000 }),
    /HTTP 500: boom/,
  )

  const networkError = (async () => {
    throw new Error('ECONNREFUSED')
  }) as unknown as typeof fetch
  await assert.rejects(
    postJson({ url: 'u', headers: {}, body: {}, fetchImpl: networkError, timeoutMs: 1000 }),
    /model request failed: ECONNREFUSED/,
  )

  const badBody = (async () => new Response('not json', { status: 200 })) as typeof fetch
  await assert.rejects(
    postJson({ url: 'u', headers: {}, body: {}, fetchImpl: badBody, timeoutMs: 1000 }),
    /model response is not valid JSON/,
  )
})
