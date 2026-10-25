import assert from 'node:assert/strict'
import { test } from 'node:test'

import { BashTool } from './bash.ts'

test('returns the exit code and merged output', async () => {
  const tool = new BashTool()

  const output = await tool.execute({ command: 'echo hello; echo oops >&2' })

  assert.match(output, /^exit_code: 0\n\n/)
  assert.match(output, /hello/)
  assert.match(output, /oops/)
})

test('non-zero exit codes are preserved', async () => {
  const tool = new BashTool()

  const output = await tool.execute({ command: 'exit 3' })

  assert.match(output, /^exit_code: 3\n\n/)
})

test('a missing or non-string command is an error result, not a throw', async () => {
  const tool = new BashTool()

  assert.match(await tool.execute({}), /error: command must be a non-empty string/)
  assert.match(await tool.execute({ command: 42 }), /error: command must be a non-empty string/)
  assert.match(await tool.execute({ command: '   ' }), /error: command must be a non-empty string/)
})

test('timeout kills the process group and reports it', async () => {
  const tool = new BashTool({ timeoutMs: 150 })
  const startedAt = Date.now()

  const output = await tool.execute({ command: 'sleep 5' })

  assert.match(output, /命令超时/)
  assert.ok(Date.now() - startedAt < 4_000)
})

test('oversized output is truncated to head and tail', async () => {
  const tool = new BashTool({ maxSideBytes: 64 })

  const output = await tool.execute({ command: 'yes | head -c 1200000' })

  assert.match(output, /输出已截断/)
  assert.match(output, /^exit_code: 0/)
  assert.ok(output.length < 500)
})
