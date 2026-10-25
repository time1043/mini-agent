/**
 * CLI 适配器：交互式命令行入口。
 * 每轮对话独立捕获错误——网络失败打印后继续，已落盘的消息不丢。
 */
import { createInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'

import { AgentService } from '../../app/service.ts'
import type { Message } from '../../domain/session.ts'
import { CYAN, GRAY, RESET, banner } from './ui.ts'

export interface CliIo {
  input?: Readable
  output?: Writable
}

export interface CliRunOptions {
  /** 提供则恢复已有会话；缺省新建。 */
  sessionId?: string
}

export class CliApp {
  #service: AgentService
  #input: Readable
  #output: Writable

  constructor(service: AgentService, io: CliIo = {}) {
    this.#service = service
    this.#input = io.input ?? process.stdin
    this.#output = io.output ?? process.stdout
  }

  /** SessionNotFoundError 会原样上抛（恢复不存在的会话由组合根决定退出码）。 */
  async run(options: CliRunOptions = {}): Promise<void> {
    banner(this.#output)
    const session = options.sessionId
      ? await this.#service.loadSession(options.sessionId)
      : await this.#service.newSession()
    this.#output.write(`会话：${session.id}\n`)

    const rl = createInterface({ input: this.#input, output: this.#output })
    rl.on('SIGINT', () => rl.close())

    // 行队列：chat 进行期间到达的输入不能丢（question 只接下一次 line 事件）。
    const pending: string[] = []
    let closed = false
    let notify: (() => void) | null = null
    rl.on('line', (line) => {
      pending.push(line)
      notify?.()
    })
    rl.on('close', () => {
      closed = true
      notify?.()
    })
    const nextLine = (): Promise<string> =>
      new Promise((resolve) => {
        const queued = pending.shift()
        if (queued !== undefined) {
          resolve(queued)
          return
        }
        if (closed) {
          resolve('')
          return
        }
        notify = () => {
          notify = null
          resolve(pending.shift() ?? '')
        }
        this.#output.write(`\n${CYAN}>>> ${RESET}`)
      })

    try {
      for (;;) {
        const text = (await nextLine()).trim()
        if (text === '') break
        this.#output.write('\n')
        try {
          await this.#service.chat(session.id, text, (message) => this.#show(message))
        } catch (error) {
          this.#output.write(`${GRAY}错误：${error instanceof Error ? error.message : String(error)}${RESET}\n`)
        }
      }
    } finally {
      rl.close()
    }
  }

  #show(message: Message): void {
    switch (message.kind) {
      case 'assistant':
        if (message.text !== '') this.#output.write(`${message.text}\n`)
        for (const call of message.toolCalls) {
          this.#output.write(`${CYAN}$ ${call.toolName} ${JSON.stringify(call.arguments)}${RESET}\n`)
        }
        break
      case 'tool_result':
        this.#output.write(`${GRAY}${message.content}${RESET}\n`)
        break
      default:
        break
    }
  }
}
