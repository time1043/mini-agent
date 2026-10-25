/**
 * 应用层端口（依赖倒置）：领域与应用只依赖这里的抽象，不依赖具体实现。
 */
import type { Context } from '../domain/context.ts'
import type { Session } from '../domain/session.ts'

/** 推理力度；各模型客户端负责映射到自家的参数，off 表示不发该字段。 */
export type Effort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export const EFFORTS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const

export function isEffort(value: unknown): value is Effort {
  return typeof value === 'string' && (EFFORTS as readonly string[]).includes(value)
}

export interface ModelSettings {
  readonly modelId: string
  readonly effort: Effort
}

export class SessionNotFoundError extends Error {
  readonly sessionId: string

  constructor(sessionId: string) {
    super(`session not found: ${sessionId}`)
    this.name = 'SessionNotFoundError'
    this.sessionId = sessionId
  }
}

/** 模型调用失败：HTTP 非 2xx、网络错误、响应体不可解析、输出不合规。 */
export class ModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelError'
  }
}

export interface SessionStore {
  list(): Promise<readonly Session[]>
  save(session: Session): Promise<void>
  /** 找不到会话时抛 SessionNotFoundError。 */
  load(sessionId: string): Promise<Session>
}

export interface ModelClient {
  /** assistant codec：解析各家协议得到 AssistantMessage；json codec：要求模型只回 JSON 并经 decode 校验。 */
  generate<O>(context: Context<O>, modelSettings: ModelSettings): Promise<O>
}
