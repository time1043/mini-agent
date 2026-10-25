import type { Context, OutputCodec } from './context.ts'
import type { AssistantMessage, Session, ToolCall, UserMessage } from './session.ts'
import type { Tool } from './tool.ts'

/**
 * 角色：向用户回复的 Assistant，与审查工具调用的 ToolCallReviewer。
 * 两个角色只负责「构造 Context」，真正调用模型的是应用层的 ModelClient。
 */
import { assistantOutput, jsonOutput } from './context.ts'
import { userMessage } from './session.ts'

export interface Decision {
  readonly shouldAllow: boolean
  readonly reason: string | null
}

/**
 * 强校验：should_allow 必须是 boolean——字符串 "false" 一律拒绝（fail-closed 的第一道闸）。
 */
export function decodeDecision(value: unknown): Decision {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`invalid decision json: ${JSON.stringify(value)}`)
  }
  const record = value as Record<string, unknown>
  if (typeof record['should_allow'] !== 'boolean') {
    throw new Error(`invalid decision json: ${JSON.stringify(value)}`)
  }
  const reason = record['reason']
  if (reason !== undefined && reason !== null && typeof reason !== 'string') {
    throw new Error(`invalid decision json: ${JSON.stringify(value)}`)
  }
  return { shouldAllow: record['should_allow'], reason: typeof reason === 'string' ? reason : null }
}

/** 面向模型的契约用 snake_case，decode 负责翻译成 camelCase 的 Decision。 */
export const decisionOutput: OutputCodec<Decision> = jsonOutput(
  '{"should_allow": boolean, "reason": string | null}',
  decodeDecision,
)

export class Assistant {
  readonly instruction: string
  readonly tools: readonly Tool[]

  constructor(instruction: string, tools: readonly Tool[] = []) {
    this.instruction = instruction
    this.tools = [...tools]
  }

  context(session: Session): Context<AssistantMessage> {
    return {
      instruction: this.instruction,
      tools: this.tools,
      messages: [...session.messages],
      output: assistantOutput,
    }
  }
}

export class ToolCallReviewer {
  readonly instruction: string

  constructor(instruction: string) {
    this.instruction = instruction
  }

  /** 审查看「用户最近的请求 + 待审调用本身」；需要更多历史时再扩展。 */
  context(session: Session, call: ToolCall): Context<Decision> {
    const lastUser = [...session.messages]
      .reverse()
      .find((message): message is UserMessage => message.kind === 'user')
    const pending = userMessage(JSON.stringify({ tool: call.toolName, arguments: call.arguments }))
    return {
      instruction: this.instruction,
      tools: [],
      messages: lastUser ? [lastUser, pending] : [pending],
      output: decisionOutput,
    }
  }
}
