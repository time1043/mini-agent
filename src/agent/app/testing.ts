/**
 * 测试替身（fakes）：实现应用层端口，供 service / web / cli 测试共享。
 */
import { SessionNotFoundError } from './ports.ts'
import type { ModelClient, ModelSettings, SessionStore } from './ports.ts'
import type { Context } from '../domain/context.ts'
import type { Session, SessionJSON } from '../domain/session.ts'
import type { Json } from '../domain/json.ts'
import type { Tool } from '../domain/tool.ts'

export class FakeTool implements Tool {
  readonly name: string
  readonly description = 'a fake tool'
  readonly parameters = { type: 'object', properties: {}, required: [] }

  readonly calls: Record<string, Json>[] = []
  #reply: string

  constructor(name: string, reply: string) {
    this.name = name
    this.#reply = reply
  }

  async execute(args: Record<string, Json>): Promise<string> {
    this.calls.push(args)
    return this.#reply
  }
}

/** 内存会话表；save 时留下快照，用于断言「每条消息即落盘」。 */
export class MemorySessionStore implements SessionStore {
  readonly snapshots: SessionJSON[] = []
  #sessions = new Map<string, Session>()

  async list(): Promise<readonly Session[]> {
    return [...this.#sessions.values()]
  }

  async save(session: Session): Promise<void> {
    this.#sessions.set(session.id, session)
    this.snapshots.push(session.toJSON())
  }

  async load(sessionId: string): Promise<Session> {
    const session = this.#sessions.get(sessionId)
    if (!session) throw new SessionNotFoundError(sessionId)
    return session
  }
}

/**
 * 按顺序吐出预设输出的模型客户端，并记录收到的 context。
 * 预设值是「解码后」的对象（Decision 等）；放入 Error 实例则原样抛出。
 */
export class ScriptedModelClient implements ModelClient {
  readonly contexts: Context<unknown>[] = []
  readonly settings: ModelSettings[] = []
  #outputs: unknown[]

  constructor(outputs: unknown[]) {
    this.#outputs = [...outputs]
  }

  async generate<O>(context: Context<O>, modelSettings: ModelSettings): Promise<O> {
    this.contexts.push(context)
    this.settings.push(modelSettings)
    const output = this.#outputs.shift()
    if (output instanceof Error) throw output
    return output as O
  }
}
