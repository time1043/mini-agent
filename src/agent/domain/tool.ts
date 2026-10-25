/**
 * Tool 领域抽象：能力由适配层实现，参数来自模型，输出回给模型。
 * parameters 是标准 JSON Schema，原样发给各家 API。
 */
import type { Json } from './json.ts'

export interface Tool {
  readonly name: string
  readonly description: string
  readonly parameters: Json

  /** arguments 来自模型的 ToolCall（不可信），返回值成为 ToolResult.content。 */
  execute(args: Record<string, Json>): Promise<string>
}
