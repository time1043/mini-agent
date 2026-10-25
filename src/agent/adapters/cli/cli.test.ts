import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Readable, Writable } from 'node:stream'

import { Assistant, ToolCallReviewer } from '../../domain/roles.ts'
import { assistantMessage } from '../../domain/session.ts'
import { AgentService } from '../../app/service.ts'
import { MemorySessionStore, ScriptedModelClient } from '../../app/testing.ts'
import { CliApp } from './cli.ts'

const aCli = (outputs: unknown[], lines: string[] = []) => {
  const store = new MemorySessionStore()
  const service = new AgentService({
    modelClient: new ScriptedModelClient(outputs),
    sessionStore: store,
    assistant: new Assistant('指令'),
    reviewer: new ToolCallReviewer('审查'),
    assistantModelSettings: { modelId: 'm', effort: 'off' },
    reviewerModelSettings: { modelId: 'm', effort: 'off' },
    maxTurns: 2,
  })
  const chunks: string[] = []
  const output = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(chunk.toString('utf8'))
      callback()
    },
  })
  const cli = new CliApp(service, {
    input: Readable.from(lines.map((line) => `${line}\n`)),
    output,
  })
  return { service, cli, rendered: () => chunks.join('') }
}

test('an empty session renders banner and session id, then EOF exits', async () => {
  const { cli, rendered } = aCli([])

  await cli.run()

  assert.ok(rendered().length > 0)
  assert.match(rendered(), /会话：[0-9]{8}-[0-9]{6}-[0-9a-f]{8}/)
})

test('a full turn renders assistant text, tool calls and results', async () => {
  const { cli, rendered } = aCli(
    [
      assistantMessage('执行', [{ id: 'c1', toolName: 'bash', arguments: { command: 'ls' } }]),
      { shouldAllow: false, reason: '危险' },
    ],
    ['删掉文件'],
  )

  await cli.run()

  assert.match(rendered(), /执行/)
  assert.match(rendered(), /\$ bash \{"command":"ls"\}/)
  assert.match(rendered(), /审查未通过：危险/)
})

test('chat errors keep the REPL alive', async () => {
  const { cli, rendered } = aCli(
    [new Error('HTTP 500: down'), assistantMessage('恢复了')],
    ['第一句', '第二句'],
  )

  await cli.run()

  assert.match(rendered(), /错误：HTTP 500: down/)
  assert.match(rendered(), /恢复了/)
})

test('resuming a missing session surfaces SessionNotFoundError', async () => {
  const { cli } = aCli([])

  await assert.rejects(cli.run({ sessionId: '20260101-000000-aaaaaaaa' }), /session not found/)
})

test('resuming an existing session reuses its id', async () => {
  const { service, cli, rendered } = aCli([])
  const session = await service.newSession()

  await cli.run({ sessionId: session.id })

  assert.match(rendered(), new RegExp(`会话：${session.id}`))
})
