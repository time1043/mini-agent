/**
 * Context：一次模型调用所需的全部输入，O 是期望的输出类型。
 * TS 没有运行时反射，笔记里的 output_type: type[O] 由 OutputCodec 补齐：
 * 它同时携带「期望什么」与「怎么把模型回复解码成 O」。
 */
import type { AssistantMessage, Message } from './session.ts'
import type { Tool } from './tool.ts'

export type OutputCodec<O> =
  | { readonly kind: 'assistant'; decode(reply: AssistantMessage): O }
  | { readonly kind: 'json'; readonly jsonHint: string; decode(value: unknown): O }

/** 原生对话输出：适配层把各家回复映射成 AssistantMessage，decode 恒等。 */
export const assistantOutput: OutputCodec<AssistantMessage> = {
  kind: 'assistant',
  decode: (reply) => reply,
}

/** 结构化输出：要求模型只回一个 JSON 对象；jsonHint 描述字段，decode 强校验。 */
export const jsonOutput = <O>(
  jsonHint: string,
  decode: (value: unknown) => O,
): OutputCodec<O> => ({ kind: 'json', jsonHint, decode })

export interface Context<O> {
  readonly instruction: string
  readonly tools: readonly Tool[]
  readonly messages: readonly Message[]
  readonly output: OutputCodec<O>
}
