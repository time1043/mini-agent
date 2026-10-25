/**
 * CLI 视觉资产：颜色与 banner（从 ts/base 的过程式 agent 迁入）。
 */
import { spawnSync } from 'node:child_process'
import type { Writable } from 'node:stream'

export const GRAY = '\x1b[90m'
export const CYAN = '\x1b[36m'
export const RESET = '\x1b[0m'

export function banner(output: Writable): void {
  const result = spawnSync('toilet', ['-f', 'mono9', 'Agent'], { encoding: 'utf8' })
  output.write(result.status === 0 && result.stdout ? result.stdout : 'MiniAgent\n')
}
