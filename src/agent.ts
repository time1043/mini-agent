#!/usr/bin/env node

import { Agent, type AgentEvent, type AgentTool } from '@earendil-works/pi-agent-core'
import { Type } from '@earendil-works/pi-ai'
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const GRAY = '\x1b[90m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

const SYSTEM_PROMPT = '使用 bash 完成当前目录下的任务。中文回复。'

const PROVIDER = 'deepseek'
const MODEL = 'deepseek-flash'

function loadApiKey(provider: string, filename = join(homedir(), '.pi/agent/auth.json')): string {
  const auth = JSON.parse(readFileSync(filename, 'utf-8'))
  return auth[provider.toLowerCase()]['key']
}

function runBash(command: string): string {
  process.stdout.write(`\n${CYAN}$ ${command}${RESET}\n`)
  let output: string
  const result = spawnSync('bash', ['-c', command], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
    encoding: 'utf8',
  })
  if (result.signal === 'SIGTERM') {
    output = '命令超时。'
  } else {
    output = `exit_code: ${result.status}\n\n${result.stdout ?? ''}${result.stderr ?? ''}`
  }
  process.stdout.write(`${output}\n`)
  return output
}

const models = builtinModels()

const BASH_PARAMS = Type.Object({ command: Type.String() })

const BASH_TOOL: AgentTool<typeof BASH_PARAMS> = {
  name: 'bash',
  label: 'Bash',
  description: '在独立、非交互的 bash 进程中执行命令。返回退出码和输出。',
  parameters: BASH_PARAMS,
  execute: async (_toolCallId, params) => ({
    content: [{ type: 'text', text: runBash(params.command) }],
    details: undefined,
  }),
}

async function main(): Promise<void> {
  const banner = spawnSync('toilet', ['-f', 'mono9', 'Agent'], { stdio: 'inherit' })
  if (banner.error) console.log('MiniAgent')

  const apiKey = loadApiKey('DeepSeek')
  const agent = new Agent({
    initialState: {
      systemPrompt: SYSTEM_PROMPT,
      model: models.getModel(PROVIDER, MODEL)!,
      thinkingLevel: 'medium',
      tools: [BASH_TOOL],
    },
    streamFn: models.streamSimple.bind(models),
    getApiKey: async () => apiKey,
  })

  let printingThinking = false
  agent.subscribe((event: AgentEvent) => {
    if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent
      if (delta.type === 'thinking_delta') {
        printingThinking = true
        process.stdout.write(`${GRAY}${delta.delta}${RESET}`)
      } else if (delta.type === 'text_delta') {
        if (printingThinking) {
          process.stdout.write('\n\n')
          printingThinking = false
        }
        process.stdout.write(delta.delta)
      }
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      printingThinking = false
      process.stdout.write('\n')
      if (event.message.stopReason === 'error') {
        process.stdout.write(`[error] ${event.message.errorMessage ?? 'unknown'}\n`)
      }
    }
  })

  const rl = createInterface({ input: process.stdin })
  rl.pause()
  rl.on('SIGINT', () => rl.close())
  rl.on('close', () => {
    process.stdout.write('\n')
    process.exit(0)
  })

  for (;;) {
    rl.resume()
    process.stdout.write(`\n${CYAN}>>> ${RESET}`)
    const userInput = (
      (await new Promise<string | undefined>((resolve) => rl.question('', resolve))) ?? ''
    ).trim()
    rl.pause()
    if (!userInput) break
    process.stdout.write('\n')
    await agent.prompt(userInput)
  }
}

main()
