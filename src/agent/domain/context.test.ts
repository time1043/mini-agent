import assert from 'node:assert/strict'
import { test } from 'node:test'

import { assistantOutput, jsonOutput } from './context.ts'
import { assistantMessage, userMessage } from './session.ts'

test('assistant output codec is the identity decode', () => {
  const reply = assistantMessage('hi')
  assert.equal(assistantOutput.kind, 'assistant')
  assert.equal(assistantOutput.decode(reply), reply)
})

test('json output codec carries the hint and decodes', () => {
  const codec = jsonOutput<{ n: number }>('"n": number', (value) => ({ n: (value as { n: number }).n }))
  assert.equal(codec.kind, 'json')
  assert.equal(codec.jsonHint, '"n": number')
  assert.deepEqual(codec.decode({ n: 1 }), { n: 1 })
})

test('context holds instruction, tools, messages and output', () => {
  const context = {
    instruction: 'reply',
    tools: [],
    messages: [userMessage('hi'), assistantMessage('ok')],
    output: assistantOutput,
  }
  assert.deepEqual(context.messages, [userMessage('hi'), assistantMessage('ok')])
})
