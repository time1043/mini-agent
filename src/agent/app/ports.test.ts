import assert from 'node:assert/strict'
import { test } from 'node:test'

import { EFFORTS, ModelError, SessionNotFoundError, isEffort } from './ports.ts'

test('isEffort accepts exactly the six levels', () => {
  for (const effort of EFFORTS) {
    assert.ok(isEffort(effort))
  }
  assert.equal(isEffort('OFF'), false)
  assert.equal(isEffort('ultra'), false)
  assert.equal(isEffort(3), false)
  assert.equal(isEffort(undefined), false)
})

test('session not found error carries the id', () => {
  const error = new SessionNotFoundError('20261025-000000-abcd1234')
  assert.ok(error instanceof Error)
  assert.equal(error.sessionId, '20261025-000000-abcd1234')
  assert.match(error.message, /20261025-000000-abcd1234/)
})

test('model error is a typed error', () => {
  const error = new ModelError('HTTP 500: boom')
  assert.ok(error instanceof Error)
  assert.equal(error.name, 'ModelError')
})
