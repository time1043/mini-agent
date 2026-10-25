/**
 * 类型级 JSON 值：一切「发给模型、落盘」的领域数据都用它描述。
 */
export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json }

export function isJsonObject(value: unknown): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
