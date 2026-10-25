#!/usr/bin/env node
/**
 * 组合根：选择适配器并装配 AgentService（笔记的 Compose / Entry）。
 * 这里是全仓库唯一知道具体实现的地方。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { WebApi } from './adapters/api/web.ts'
import { CliApp } from './adapters/cli/cli.ts'
import type { ClientOptions } from './adapters/models/common.ts'
import { AnthropicModelClient } from './adapters/models/anthropic_client.ts'
import { GoogleModelClient } from './adapters/models/google_client.ts'
import { OpenAIModelClient } from './adapters/models/openai_client.ts'
import { JsonlSessionStore } from './adapters/stores/jsonl.ts'
import { BashTool } from './adapters/tools/bash.ts'
import { isEffort } from './app/ports.ts'
import type { Effort, ModelClient, ModelSettings } from './app/ports.ts'
import { SessionNotFoundError } from './app/ports.ts'
import { AgentService } from './app/service.ts'
import { Assistant, ToolCallReviewer } from './domain/roles.ts'

const ASSISTANT_INSTRUCTION = '使用 bash 完成当前目录下的任务。中文回复。'
const REVIEWER_INSTRUCTION = '你是工具调用审查员。判断待执行的工具调用是否应该允许执行。'
const AUTH_FILE = join(homedir(), '.pi', 'agent', 'auth.json')
const DEFAULT_STORE = join(homedir(), '.mini-agent', 'sessions')
const MAX_TURNS = 8

interface ProviderSpec {
  baseUrl: string
  defaultModel: string
  create: (options: ClientOptions) => ModelClient
}

const PROVIDERS: Record<string, ProviderSpec> = {
  deepseek: {
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-flash',
    create: (options) => new OpenAIModelClient(options),
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    create: (options) => new AnthropicModelClient(options),
  },
  google: {
    baseUrl: 'https://generativelanguage.googleapis.com',
    defaultModel: 'gemini-3-flash',
    create: (options) => new GoogleModelClient(options),
  },
}

export function loadApiKey(provider: string, filename: string = AUTH_FILE): string {
  let auth: unknown
  try {
    auth = JSON.parse(readFileSync(filename, 'utf8'))
  } catch (error) {
    throw new Error(`无法读取 ${filename}：${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof auth !== 'object' || auth === null) {
    throw new Error(`${filename} 的内容不是 JSON 对象`)
  }
  const record = auth as Record<string, unknown>
  const entry = record[provider] ?? record[provider.toLowerCase()]
  if (typeof entry !== 'object' || entry === null) {
    throw new Error(`${filename} 中缺少 provider "${provider}" 的配置`)
  }
  const key = (entry as Record<string, unknown>)['key']
  if (typeof key !== 'string') {
    throw new Error(`${filename} 中 provider "${provider}" 缺少 key`)
  }
  return key
}

function requireEffort(value: string): Effort {
  if (!isEffort(value)) {
    throw new Error(`无效的 effort：${value}（可选：off low medium high xhigh max）`)
  }
  return value
}

function parseCli() {
  return parseArgs({
    options: {
      web: { type: 'boolean', default: false },
      provider: { type: 'string', default: 'deepseek' },
      model: { type: 'string' },
      'reviewer-model': { type: 'string' },
      effort: { type: 'string', default: 'off' },
      'reviewer-effort': { type: 'string' },
      session: { type: 'string' },
      store: { type: 'string', default: DEFAULT_STORE },
    },
  })
}

function buildService(
  provider: string,
  model: string | undefined,
  reviewerModel: string | undefined,
  effort: Effort,
  reviewerEffort: Effort,
  storeRoot: string,
): AgentService {
  const spec = PROVIDERS[provider]
  if (!spec) {
    throw new Error(`未知 provider：${provider}（可选：${Object.keys(PROVIDERS).join(' ')}）`)
  }
  const assistantSettings: ModelSettings = { modelId: model ?? spec.defaultModel, effort }
  const reviewerSettings: ModelSettings = {
    modelId: reviewerModel ?? model ?? spec.defaultModel,
    effort: reviewerEffort,
  }
  return new AgentService({
    modelClient: spec.create({ baseUrl: spec.baseUrl, apiKey: loadApiKey(provider) }),
    sessionStore: new JsonlSessionStore(storeRoot),
    assistant: new Assistant(ASSISTANT_INSTRUCTION, [new BashTool()]),
    reviewer: new ToolCallReviewer(REVIEWER_INSTRUCTION),
    assistantModelSettings: assistantSettings,
    reviewerModelSettings: reviewerSettings,
    maxTurns: MAX_TURNS,
  })
}

async function main(): Promise<void> {
  const args = parseCli()
  const provider = args.values.provider ?? 'deepseek'
  const effort = requireEffort(args.values.effort ?? 'off')
  const reviewerEffort = args.values['reviewer-effort']
    ? requireEffort(args.values['reviewer-effort'])
    : effort
  const service = buildService(
    provider,
    args.values.model,
    args.values['reviewer-model'],
    effort,
    reviewerEffort,
    args.values.store ?? DEFAULT_STORE,
  )

  if (args.values.web) {
    const server = await new WebApi(service).run('127.0.0.1', 3000)
    console.log('mini-agent web api: http://127.0.0.1:3000')
    process.on('SIGINT', () => server.close(() => process.exit(0)))
    return
  }

  try {
    await new CliApp(service).run({ sessionId: args.values.session })
  } catch (error) {
    if (error instanceof SessionNotFoundError) {
      throw new Error(`会话不存在：${error.sessionId}`)
    }
    throw error
  }
}

main().catch((error: unknown) => {
  console.error(`mini-agent：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
