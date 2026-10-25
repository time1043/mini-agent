import type { OutputCodec } from '../../domain/context.ts'

/**
 * 模型客户端共享逻辑：结构化输出的提示注入与提取、统一的 HTTP POST。
 * 所有模型侧失败都折叠成 ModelError，让上层可以按类型处理。
 */
import { ModelError } from '../../app/ports.ts'

export interface ClientOptions {
  baseUrl: string
  apiKey: string
  /** 注入点：测试用假 fetch，生产用全局 fetch。 */
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

export const DEFAULT_TIMEOUT_MS = 120_000

/** json codec 时把 JSON 契约追加进指令；assistant codec 原样返回。 */
export function appendJsonHint<O>(instruction: string, output: OutputCodec<O>): string {
  if (output.kind !== 'json') return instruction
  return `${instruction}\n\n只输出一个 JSON 对象，不要包含其他文字，不要使用代码围栏。字段：${output.jsonHint}`
}

/** 从模型回复中提取 JSON 对象：剥代码围栏，取首个 { 到末个 }。 */
export function extractJson(text: string): unknown {
  let stripped = text.trim()
  if (stripped.startsWith('```')) {
    stripped = stripped.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '')
  }
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end === -1 || end < start) {
    throw new ModelError(`model output has no JSON object: ${text.slice(0, 200)}`)
  }
  try {
    return JSON.parse(stripped.slice(start, end + 1))
  } catch (error) {
    throw new ModelError(`model output is not valid JSON: ${(error as Error).message}`)
  }
}

export interface PostJsonArgs {
  url: string
  headers: Record<string, string>
  body: unknown
  fetchImpl: typeof fetch
  timeoutMs: number
}

export async function postJson({
  url,
  headers,
  body,
  fetchImpl,
  timeoutMs,
}: PostJsonArgs): Promise<unknown> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new ModelError(`model request failed: ${(error as Error).message}`)
  }
  if (!response.ok) {
    const text = await response.text()
    throw new ModelError(`HTTP ${response.status}: ${text.slice(0, 500)}`)
  }
  try {
    return await response.json()
  } catch (error) {
    throw new ModelError(`model response is not valid JSON: ${(error as Error).message}`)
  }
}

/** 从响应里取 choices[0].message；形状不对快速报错。 */
export function extractChatMessage(response: unknown): Record<string, unknown> {
  const choices = (response as { choices?: unknown })['choices']
  const message = Array.isArray(choices)
    ? (choices[0] as { message?: unknown } | undefined)?.['message']
    : undefined
  if (typeof message !== 'object' || message === null) {
    throw new ModelError(`unexpected response shape: ${JSON.stringify(response).slice(0, 200)}`)
  }
  return message as Record<string, unknown>
}
