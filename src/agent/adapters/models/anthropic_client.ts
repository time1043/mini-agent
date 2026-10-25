/**
 * Anthropic Messages API 客户端。
 * 渲染上有两个防「会话变砖」的口径：
 * - 空 assistant content（无文本也无工具调用）会补占位文本块——空 content 数组会被 API 拒绝；
 * - 工具结果与后续用户文本合并进同一条 user 消息——对要求角色交替的旧版/代理实现保持兼容。
 */
import { ModelError } from '../../app/ports.ts'
import type { ModelClient, ModelSettings } from '../../app/ports.ts'
import type { Context, OutputCodec } from '../../domain/context.ts'
import type { Json } from '../../domain/json.ts'
import { assistantMessage } from '../../domain/session.ts'
import type { Message, ToolCall } from '../../domain/session.ts'
import { DEFAULT_TIMEOUT_MS, appendJsonHint, extractJson, postJson } from './common.ts'
import type { ClientOptions } from './common.ts'

export interface AnthropicClientOptions extends ClientOptions {
  maxTokens?: number
}

const DEFAULT_MAX_TOKENS = 4096

export class AnthropicModelClient implements ModelClient {
  #baseUrl: string
  #apiKey: string
  #maxTokens: number
  #fetchImpl: typeof fetch
  #timeoutMs: number

  constructor(options: AnthropicClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, '')
    this.#apiKey = options.apiKey
    this.#maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
    this.#fetchImpl = options.fetchImpl ?? fetch
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async generate<O>(context: Context<O>, modelSettings: ModelSettings): Promise<O> {
    const payload: Record<string, unknown> = {
      model: modelSettings.modelId,
      max_tokens: this.#maxTokens,
      system: appendJsonHint(context.instruction, context.output),
      messages: toEntries(context.messages),
    }
    if (context.tools.length > 0) {
      payload['tools'] = context.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.parameters,
      }))
    }
    if (modelSettings.effort !== 'off') {
      payload['output_config'] = { effort: modelSettings.effort }
    }

    const response = await postJson({
      url: `${this.#baseUrl}/v1/messages`,
      headers: { 'x-api-key': this.#apiKey, 'anthropic-version': '2023-06-01' },
      body: payload,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
    })
    const blocks = (response as { content?: unknown })['content']
    if (!Array.isArray(blocks)) {
      throw new ModelError(`unexpected response shape: ${JSON.stringify(response).slice(0, 200)}`)
    }
    return decodeContent(context.output, blocks)
  }
}

interface Entry {
  role: 'user' | 'assistant'
  content: Record<string, unknown>[]
}

export function toEntries(messages: readonly Message[]): Entry[] {
  const entries: Entry[] = []
  const pushUserBlock = (block: Record<string, unknown>): void => {
    const last = entries[entries.length - 1]
    if (last && last.role === 'user') last.content.push(block)
    else entries.push({ role: 'user', content: [block] })
  }
  for (const message of messages) {
    switch (message.kind) {
      case 'user':
        pushUserBlock({ type: 'text', text: message.text })
        break
      case 'assistant': {
        const blocks: Record<string, unknown>[] = []
        if (message.text !== '') blocks.push({ type: 'text', text: message.text })
        blocks.push(
          ...message.toolCalls.map((call) => ({
            type: 'tool_use',
            id: call.id,
            name: call.toolName,
            input: call.arguments,
          })),
        )
        if (blocks.length === 0) blocks.push({ type: 'text', text: '(no content)' })
        entries.push({ role: 'assistant', content: blocks })
        break
      }
      case 'tool_result':
        pushUserBlock({ type: 'tool_result', tool_use_id: message.toolCallId, content: message.content })
        break
    }
  }
  return entries
}

function asObject(value: unknown): Record<string, Json> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {}
}

function decodeContent<O>(output: OutputCodec<O>, blocks: unknown[]): O {
  let text = ''
  const calls: ToolCall[] = []
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue
    const record = block as Record<string, unknown>
    if (record['type'] === 'text' && typeof record['text'] === 'string') {
      text += record['text']
    } else if (record['type'] === 'tool_use' && typeof record['id'] === 'string' && typeof record['name'] === 'string') {
      calls.push({ id: record['id'], toolName: record['name'], arguments: asObject(record['input']) })
    }
  }
  if (output.kind === 'assistant') return output.decode(assistantMessage(text, calls))
  return output.decode(extractJson(text))
}
