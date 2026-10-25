import assert from 'node:assert/strict'
import { test } from 'node:test'

// 原生 type stripping 运行时的冒烟检查：确认 .ts 文件确实由 node 直接执行。
test('node runs typescript natively', () => {
  assert.ok(process.features.typescript)
})
