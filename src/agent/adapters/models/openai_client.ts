import type { ModelClient, ModelSettings } from '../../app/ports.ts'
import type { Context, OutputCodec } from '../../domain/context.ts'
import type { Json } from '../../domain/json.ts'
import type { Message, ToolCall } from '../../domain/session.ts'
import type { Tool } from '../../domain/tool.ts'
import type { ClientOptions } from './common.ts'

/**
 * OpenAI 兼容客户端（DeepSeek 等同款协议）。
 */
import { ModelError } from '../../app/ports.ts'
import { assistantMessage } from '../../domain/session.ts'
import {
  DEFAULT_TIMEOUT_MS,
  appendJsonHint,
  extractChatMessage,
  extractJson,
  postJson,
} from './common.ts'

export class OpenAIModelClient implements ModelClient {
  #baseUrl: string
  #apiKey: string
  #fetchImpl: typeof fetch
  #timeoutMs: number

  constructor(options: ClientOptions) {
    this.#baseUrl = options.baseUrl.replace(/\/$/, '')
    this.#apiKey = options.apiKey
    this.#fetchImpl = options.fetchImpl ?? fetch
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async generate<O>(context: Context<O>, modelSettings: ModelSettings): Promise<O> {
    const payload: Record<string, unknown> = {
      model: modelSettings.modelId,
      messages: [
        { role: 'system', content: appendJsonHint(context.instruction, context.output) },
        ...context.messages.map(toEntry),
      ],
    }
    if (context.tools.length > 0) payload['tools'] = context.tools.map(toolSpec)
    if (modelSettings.effort !== 'off') payload['reasoning_effort'] = modelSettings.effort

    const response = await postJson({
      url: `${this.#baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${this.#apiKey}` },
      body: payload,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
    })
    return decodeOutput(context.output, extractChatMessage(response))
  }
}

function toEntry(message: Message): Record<string, unknown> {
  switch (message.kind) {
    case 'user':
      return { role: 'user', content: message.text }
    case 'assistant': {
      const entry: Record<string, unknown> = { role: 'assistant', content: message.text }
      if (message.toolCalls.length > 0) {
        entry['tool_calls'] = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.toolName, arguments: JSON.stringify(call.arguments) },
        }))
      }
      return entry
    }
    case 'tool_result':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content }
  }
}

function toolSpec(tool: Tool): Record<string, unknown> {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }
}

/** 模型给的 arguments 文本不可信：解析失败一律按空参数处理。 */
function parseArguments(text: unknown): Record<string, Json> {
  try {
    const parsed = JSON.parse(typeof text === 'string' && text !== '' ? text : '{}')
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

function decodeOutput<O>(output: OutputCodec<O>, message: Record<string, unknown>): O {
  if (output.kind === 'assistant') {
    const fragments = Array.isArray(message['tool_calls'])
      ? (message['tool_calls'] as Record<string, unknown>[])
      : []
    const calls: ToolCall[] = fragments.map((fragment) => {
      const missing = (field: string): ModelError =>
        new ModelError(`unexpected tool call shape: missing ${field}`)
      const fn = fragment['function']
      if (typeof fn !== 'object' || fn === null) throw missing('function')
      const record = fn as Record<string, unknown>
      if (typeof fragment['id'] !== 'string') throw missing('id')
      if (typeof record['name'] !== 'string') throw missing('name')
      return {
        id: fragment['id'],
        toolName: record['name'],
        arguments: parseArguments(record['arguments']),
      }
    })
    return output.decode(
      assistantMessage(typeof message['content'] === 'string' ? message['content'] : '', calls),
    )
  }
  return output.decode(
    extractJson(typeof message['content'] === 'string' ? message['content'] : ''),
  )
}
