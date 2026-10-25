/**
 * 应用服务：编排会话、模型与工具，实现 agent 主循环。
 * 语义约定（与笔记 Procedure 对齐）：
 * - 一「轮」= 一次 assistant 调用 + 对其全部 toolCalls 的逐个审查与执行；
 * - maxTurns 界定 assistant 调用次数上限；回复不含 toolCalls 时提前结束；
 * - chat 返回本轮新增的消息（fresh）；每 append 一条即落盘，中途失败不丢已产生消息。
 */
import type { Assistant, ToolCallReviewer } from '../domain/roles.ts'
import type { Decision } from '../domain/roles.ts'
import { Session, toolResult, userMessage } from '../domain/session.ts'
import type { Message, ToolCall, ToolResultMessage } from '../domain/session.ts'
import type { ModelClient, ModelSettings, SessionStore } from './ports.ts'

export interface AgentServiceOptions {
  readonly modelClient: ModelClient
  readonly sessionStore: SessionStore
  readonly assistant: Assistant
  readonly reviewer: ToolCallReviewer
  readonly assistantModelSettings: ModelSettings
  readonly reviewerModelSettings: ModelSettings
  readonly maxTurns: number
}

export class AgentService {
  #modelClient: ModelClient
  #sessionStore: SessionStore
  #assistant: Assistant
  #reviewer: ToolCallReviewer
  #assistantModelSettings: ModelSettings
  #reviewerModelSettings: ModelSettings
  #maxTurns: number

  constructor(options: AgentServiceOptions) {
    this.#modelClient = options.modelClient
    this.#sessionStore = options.sessionStore
    this.#assistant = options.assistant
    this.#reviewer = options.reviewer
    this.#assistantModelSettings = options.assistantModelSettings
    this.#reviewerModelSettings = options.reviewerModelSettings
    this.#maxTurns = options.maxTurns
  }

  async newSession(): Promise<Session> {
    const session = Session.create()
    await this.#sessionStore.save(session)
    return session
  }

  async listSessions(): Promise<readonly Session[]> {
    return this.#sessionStore.list()
  }

  async loadSession(sessionId: string): Promise<Session> {
    return this.#sessionStore.load(sessionId)
  }

  async chat(
    sessionId: string,
    text: string,
    onMessage?: (message: Message) => void,
  ): Promise<readonly Message[]> {
    const session = await this.#sessionStore.load(sessionId)
    const fresh: Message[] = []

    const add = (message: Message): void => {
      session.append(message)
      fresh.push(message)
      onMessage?.(message)
    }

    add(userMessage(text))
    await this.#sessionStore.save(session)

    for (let turn = 0; turn < this.#maxTurns; turn++) {
      const reply = await this.#modelClient.generate(
        this.#assistant.context(session),
        this.#assistantModelSettings,
      )
      add(reply)
      await this.#sessionStore.save(session)
      if (reply.toolCalls.length === 0) break

      for (const call of reply.toolCalls) {
        add(await this.#runReviewed(session, call))
        await this.#sessionStore.save(session)
      }
    }
    return fresh
  }

  /** 审查门 fail-closed：reviewer 生成、解析、网络任何失败都视为拒绝。 */
  async #runReviewed(session: Session, call: ToolCall): Promise<ToolResultMessage> {
    let decision: Decision
    try {
      decision = await this.#modelClient.generate(
        this.#reviewer.context(session, call),
        this.#reviewerModelSettings,
      )
    } catch {
      return toolResult(call.id, '审查未通过：审查员不可用')
    }
    if (!decision.shouldAllow) {
      return toolResult(call.id, `审查未通过：${decision.reason ?? '审查员未提供理由'}`)
    }

    const tool = this.#assistant.tools.find((candidate) => candidate.name === call.toolName)
    if (!tool) {
      return toolResult(call.id, `error: unknown tool: ${call.toolName}`)
    }
    try {
      return toolResult(call.id, await tool.execute(call.arguments))
    } catch (error) {
      return toolResult(call.id, `error: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
