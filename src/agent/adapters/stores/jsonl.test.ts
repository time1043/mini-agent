import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { SessionNotFoundError } from '../../app/ports.ts'
import { Session, assistantMessage, toolResult, userMessage } from '../../domain/session.ts'
import { JsonlSessionStore, dump, parse } from './jsonl.ts'

const anId = '20261025-142301-9a3b7c1d'

const aSession = () =>
  Session.fromJSON({
    version: 1,
    id: anId,
    messages: [
      userMessage('hi'),
      assistantMessage('run', [{ id: 'c1', toolName: 'bash', arguments: { command: 'ls' } }]),
      toolResult('c1', 'exit_code: 0\n\n.'),
    ],
  })

const aStore = (t: import('node:test').TestContext) => {
  const root = mkdtempSync(join(tmpdir(), 'mini-agent-store-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return new JsonlSessionStore(root)
}

test('save then load roundtrips every message kind', async (t) => {
  const store = aStore(t)

  await store.save(aSession())

  const restored = await store.load(anId)
  assert.equal(restored.id, anId)
  assert.deepEqual(restored.messages, aSession().messages)
})

test('files are line-delimited json with a versioned header', async (t) => {
  const store = aStore(t)

  await store.save(aSession())

  const lines = readFileSync(join(store.root, `${anId}.jsonl`), 'utf8').split('\n')
  assert.equal(lines[0], JSON.stringify({ version: 1, id: anId }))
  assert.equal(lines.length, 5)
  assert.equal(lines[4], '')
})

test('list returns sessions ordered by filename', async (t) => {
  const store = aStore(t)
  for (const day of [26, 25, 27]) {
    await store.save(Session.create(new Date(2026, 9, day, 0, 0, 0)))
  }

  const ids = (await store.list()).map((session) => session.id)
  assert.deepEqual(
    ids,
    [...ids].sort(),
  )
})

test('loading a missing session throws SessionNotFoundError', async (t) => {
  const store = aStore(t)

  await assert.rejects(store.load('20260101-000000-aaaaaaaa'), SessionNotFoundError)
})

test('loading with a malformed id never touches the filesystem', async (t) => {
  const store = aStore(t)

  for (const bad of ['../etc/passwd', 'a/b', '', `${anId}$`]) {
    await assert.rejects(store.load(bad), SessionNotFoundError)
  }
})

test('a broken message line fails the load fast', async (t) => {
  const store = aStore(t)
  writeFileSync(join(store.root, `${anId}.jsonl`), `${JSON.stringify({ version: 1, id: anId })}\n{"kind":"nope"}\n`, 'utf8')

  await assert.rejects(store.load(anId), /unknown message kind/)
})

test('a wrong header fails the load fast', async (t) => {
  const store = aStore(t)
  writeFileSync(join(store.root, `${anId}.jsonl`), `${JSON.stringify({ version: 2, id: anId })}\n`, 'utf8')

  await assert.rejects(store.load(anId), /bad session file/)
})

test('list skips corrupted files instead of failing', async (t) => {
  const store = aStore(t)
  await store.save(aSession())
  writeFileSync(join(store.root, '20261025-142301-deadbeef.jsonl'), 'not json at all', 'utf8')

  const ids = (await store.list()).map((session) => session.id)
  assert.deepEqual(ids, [anId])
})

test('temporary files never show up in the list', async (t) => {
  const store = aStore(t)
  await store.save(aSession())
  writeFileSync(join(store.root, `${anId}.jsonl.tmp`), 'partial write', 'utf8')

  assert.deepEqual(await store.list().then((sessions) => sessions.length), 1)
  assert.deepEqual(store.files(), [`${anId}.jsonl`])
})

test('the store root is created recursively', (t) => {
  const root = join(mkdtempSync(join(tmpdir(), 'mini-agent-root-')), 'nested', 'sessions')
  t.after(() => rmSync(root, { recursive: true, force: true }))

  const store = new JsonlSessionStore(root)
  assert.deepEqual(store.files(), [])
})

test('dump then parse is the identity for a full session', () => {
  assert.deepEqual(parse(dump(aSession()), anId).messages, aSession().messages)
})
