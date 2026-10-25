/**
 * Google Gemini API 客户端。
 * Gemini 的 functionCall 不带 id：解码时按出现顺序合成 call_0、call_1…；
 * 渲染 functionResponse 时用完整历史回放建立 callId→toolName 映射，孤儿结果回退用 toolCallId。
 */
import { ModelError } from '../../app/ports.ts'
import type { ModelClient, ModelSettings } from '../../app/ports.ts'
import type { Context, OutputCodec } from '../../domain/context.ts'
import type { Json } from '../../domain/json.ts'
import { assistantMessage } from '../../domain/session.ts'
import type { Message, ToolCall } from '../../domain/session.ts'
import { DEFAULT_TIMEOUT_MS, appendJsonHint, extractJson, postJson } from './common.ts'
import type { ClientOptions } from './common.ts'

export class GoogleModelClient implements ModelClient {
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
      systemInstruction: { parts: [{ text: appendJsonHint(context.instruction, context.output) }] },
      contents: toContents(context.messages),
    }
    if (context.tools.length > 0) {
      payload['tools'] = [
        {
          functionDeclarations: context.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        },
      ]
    }
    if (modelSettings.effort !== 'off') {
      payload['generationConfig'] = { thinkingConfig: { thinkingLevel: modelSettings.effort } }
    }

    const url = `${this.#baseUrl}/v1beta/models/${modelSettings.modelId}:generateContent`
    const response = await postJson({
      url,
      headers: { 'x-goog-api-key': this.#apiKey },
      body: payload,
      fetchImpl: this.#fetchImpl,
      timeoutMs: this.#timeoutMs,
    })
    const candidates = (response as { candidates?: unknown })['candidates']
    const parts = Array.isArray(candidates)
      ? (candidates[0] as { content?: { parts?: unknown } } | undefined)?.content?.parts
      : undefined
    if (!Array.isArray(parts)) {
      throw new ModelError(`unexpected response shape: ${JSON.stringify(response).slice(0, 200)}`)
    }
    return decodeParts(context.output, parts)
  }
}

interface Content {
  role: 'user' | 'model'
  parts: Record<string, unknown>[]
}

export function toContents(messages: readonly Message[]): Content[] {
  const contents: Content[] = []
  const toolNames = new Map<string, string>()
  const pushUserPart = (part: Record<string, unknown>): void => {
    const last = contents[contents.length - 1]
    if (last && last.role === 'user' && last.parts.every((candidate) => 'functionResponse' in candidate)) {
      last.parts.push(part)
    } else {
      contents.push({ role: 'user', parts: [part] })
    }
  }
  for (const message of messages) {
    switch (message.kind) {
      case 'user':
        contents.push({ role: 'user', parts: [{ text: message.text }] })
        break
      case 'assistant': {
        for (const call of message.toolCalls) toolNames.set(call.id, call.toolName)
        const parts: Record<string, unknown>[] = []
        if (message.text !== '') parts.push({ text: message.text })
        parts.push(
          ...message.toolCalls.map((call) => ({
            functionCall: { name: call.toolName, args: call.arguments },
          })),
        )
        if (parts.length === 0) parts.push({ text: '(no content)' })
        contents.push({ role: 'model', parts })
        break
      }
      case 'tool_result':
        pushUserPart({
          functionResponse: {
            name: toolNames.get(message.toolCallId) ?? message.toolCallId,
            response: { result: message.content },
          },
        })
        break
    }
  }
  return contents
}

function asObject(value: unknown): Record<string, Json> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, Json>)
    : {}
}

function decodeParts<O>(output: OutputCodec<O>, parts: unknown[]): O {
  let text = ''
  const calls: ToolCall[] = []
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const record = part as Record<string, unknown>
    if (typeof record['text'] === 'string') {
      text += record['text']
    } else if (typeof record['functionCall'] === 'object' && record['functionCall'] !== null) {
      const call = record['functionCall'] as Record<string, unknown>
      if (typeof call['name'] === 'string') {
        calls.push({
          id: `call_${calls.length}`,
          toolName: call['name'],
          arguments: asObject(call['args']),
        })
      }
    }
  }
  if (output.kind === 'assistant') return output.decode(assistantMessage(text, calls))
  return output.decode(extractJson(text))
}
