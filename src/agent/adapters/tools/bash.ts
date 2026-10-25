import type { ChildProcess } from 'node:child_process'

/**
 * bash 工具：在独立、非交互的 bash 进程中异步执行命令。
 * - 事件循环永不被阻塞（spawn 而非 spawnSync），web 模式下其他请求不受影响；
 * - detached + 杀进程组：超时时连孙进程一起终止；
 * - 输出有硬上限，超限时保留头尾并标注截断；
 * - 模型给的 arguments 不可信：参数缺失返回错误文本而非抛异常。
 */
import { spawn } from 'node:child_process'

import type { Json } from '../../domain/json.ts'
import type { Tool } from '../../domain/tool.ts'

const TRUNCATED_MARK = '\n…[输出已截断]…\n'
const MAX_TOTAL_BYTES = 1_000_000
const SIGKILL_GRACE_MS = 5_000

export interface BashToolOptions {
  timeoutMs?: number
  maxSideBytes?: number
}

export class BashTool implements Tool {
  readonly name = 'bash'
  readonly description = '在独立、非交互的 bash 进程中执行命令。返回退出码和输出。'
  readonly parameters = {
    type: 'object',
    properties: { command: { type: 'string' } },
    required: ['command'],
  }

  #timeoutMs: number
  #maxSideBytes: number

  constructor(options: BashToolOptions = {}) {
    this.#timeoutMs = options.timeoutMs ?? 60_000
    this.#maxSideBytes = options.maxSideBytes ?? 5120
  }

  async execute(args: Record<string, Json>): Promise<string> {
    const command = args['command']
    if (typeof command !== 'string' || command.trim() === '') {
      return 'error: command must be a non-empty string'
    }
    return this.#run(command)
  }

  async #run(command: string): Promise<string> {
    const child = spawn('bash', ['-c', command], {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let head = ''
    const kept: Buffer[] = []
    let dropped = false
    let tail = Buffer.alloc(0)
    let keptBytes = 0
    const onChunk = (chunk: Buffer): void => {
      if (dropped) {
        tail = Buffer.concat([tail, chunk]).subarray(-this.#maxSideBytes)
        return
      }
      kept.push(chunk)
      keptBytes += chunk.length
      if (keptBytes > MAX_TOTAL_BYTES) {
        dropped = true
        head = Buffer.concat(kept).subarray(0, this.#maxSideBytes).toString('utf8')
        kept.length = 0
      }
    }
    child.stdout?.on('data', onChunk)
    child.stderr?.on('data', onChunk)

    const outcome = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
      let settled = false
      let timedOut = false
      let escalation: NodeJS.Timeout | undefined
      const timer = setTimeout(() => {
        timedOut = true
        this.#signal(child, 'SIGTERM')
        escalation = setTimeout(() => this.#signal(child, 'SIGKILL'), SIGKILL_GRACE_MS)
      }, this.#timeoutMs)
      child.once('error', () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (escalation) clearTimeout(escalation)
        resolve({ code: null, timedOut })
      })
      child.once('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (escalation) clearTimeout(escalation)
        resolve({ code, timedOut })
      })
    })

    const output = dropped
      ? `${head}${TRUNCATED_MARK}${tail.toString('utf8')}`
      : Buffer.concat(kept).toString('utf8')
    if (outcome.timedOut) {
      return `命令超时。\n\n${output}`
    }
    return `exit_code: ${outcome.code ?? 'null'}\n\n${output}`
  }

  /** 杀整个进程组（负 pid）；组已退出时 kill 抛 ESRCH，静默即可。 */
  #signal(child: ChildProcess, signal: NodeJS.Signals): void {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal)
    } catch {
      // 进程组已退出
    }
  }
}
