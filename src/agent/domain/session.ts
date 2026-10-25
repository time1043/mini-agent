/**
 * Session 聚合：一次对话的消息序列。
 * 运行时形状即持久化形状（camelCase，kind 判别），序列化知识归领域所有。
 */
import { randomBytes } from 'node:crypto'

import type { Json } from './json.ts'

import { isJsonObject } from './json.ts'

/** 模型发起的一次工具调用。 */
export interface ToolCall {
  readonly id: string
  readonly toolName: string
  readonly arguments: Record<string, Json>
}

export interface UserMessage {
  readonly kind: 'user'
  readonly text: string
}

export interface AssistantMessage {
  readonly kind: 'assistant'
  readonly text: string
  readonly toolCalls: readonly ToolCall[]
}

export interface ToolResultMessage {
  readonly kind: 'tool_result'
  readonly toolCallId: string
  readonly content: string
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage

export const userMessage = (text: string): UserMessage => ({ kind: 'user', text })

export const assistantMessage = (
  text: string,
  toolCalls: readonly ToolCall[] = [],
): AssistantMessage => ({ kind: 'assistant', text, toolCalls })

export const toolResult = (toolCallId: string, content: string): ToolResultMessage => ({
  kind: 'tool_result',
  toolCallId,
  content,
})

/** 消息的 JSON 形状与运行时形状相同；显式命名以便持久化契约有处可指。 */
export type MessageJSON = Message

export function messageToJSON(message: Message): MessageJSON {
  return message
}

/** 逐字段校验并还原消息；任何字段非法即抛错（坏数据快速失败，不做静默修补）。 */
export function messageFromJSON(data: unknown): Message {
  if (!isJsonObject(data)) {
    throw new Error(`invalid message json: ${JSON.stringify(data)}`)
  }
  const toolCallFromJSON = (value: unknown): ToolCall => {
    if (
      !isJsonObject(value) ||
      typeof value['id'] !== 'string' ||
      typeof value['toolName'] !== 'string' ||
      !isJsonObject(value['arguments'])
    ) {
      throw new Error(`invalid tool call json: ${JSON.stringify(value)}`)
    }
    return { id: value['id'], toolName: value['toolName'], arguments: value['arguments'] }
  }
  switch (data['kind']) {
    case 'user':
      if (typeof data['text'] !== 'string') {
        throw new Error(`invalid user message json: ${JSON.stringify(data)}`)
      }
      return userMessage(data['text'])
    case 'assistant': {
      if (typeof data['text'] !== 'string') {
        throw new Error(`invalid assistant message json: ${JSON.stringify(data)}`)
      }
      const toolCalls = data['toolCalls'] ?? []
      if (!Array.isArray(toolCalls)) {
        throw new Error(`invalid assistant message json: ${JSON.stringify(data)}`)
      }
      return assistantMessage(data['text'], toolCalls.map(toolCallFromJSON))
    }
    case 'tool_result':
      if (typeof data['toolCallId'] !== 'string' || typeof data['content'] !== 'string') {
        throw new Error(`invalid tool result json: ${JSON.stringify(data)}`)
      }
      return toolResult(data['toolCallId'], data['content'])
    default:
      throw new Error(`unknown message kind: ${JSON.stringify(data['kind'])}`)
  }
}

export interface SessionJSON {
  readonly version: number
  readonly id: string
  readonly messages: readonly Message[]
}

/** 会话 id：本地时间戳 + 8 位随机 hex；文件名排序即时间排序。 */
const ID_PATTERN = /^[0-9]{8}-[0-9]{6}-[0-9a-f]{8}$/

export class Session {
  #id: string
  #messages: Message[]

  private constructor(id: string, messages: readonly Message[]) {
    this.#id = id
    this.#messages = [...messages]
  }

  static create(now: Date = new Date()): Session {
    const pad = (value: number) => String(value).padStart(2, '0')
    const stamp =
      `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
      `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
    return new Session(`${stamp}-${randomBytes(4).toString('hex')}`, [])
  }

  static fromJSON(data: unknown): Session {
    if (
      !isJsonObject(data) ||
      data['version'] !== 1 ||
      typeof data['id'] !== 'string' ||
      !Array.isArray(data['messages'])
    ) {
      throw new Error(`invalid session json: ${JSON.stringify(data)}`)
    }
    return new Session(data['id'], data['messages'].map(messageFromJSON))
  }

  get id(): string {
    return this.#id
  }

  /** 只读视图：append 是唯一写入口。保护是类型级的，不要用 as 强转绕过。 */
  get messages(): readonly Message[] {
    return this.#messages
  }

  append(message: Message): void {
    this.#messages.push(message)
  }

  toJSON(): SessionJSON {
    return { version: 1, id: this.#id, messages: [...this.#messages] }
  }
}

export const isSessionId = (value: string): boolean => ID_PATTERN.test(value)
