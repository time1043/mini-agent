#!/usr/bin/env node

import { Type, type AssistantMessage, type Context, type Tool } from '@earendil-works/pi-ai'
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

const BASH_TOOL: Tool = {
  name: 'bash',
  description: '在独立、非交互的 bash 进程中执行命令。返回退出码和输出。',
  parameters: Type.Object({ command: Type.String() }),
}

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

async function readReply(context: Context, apiKey: string): Promise<AssistantMessage> {
  const stream = models.streamSimple(models.getModel(PROVIDER, MODEL)!, context, {
    apiKey,
    reasoning: 'medium',
  })
  let printingThinking = false
  for await (const event of stream) {
    if (event.type === 'thinking_delta') {
      printingThinking = true
      process.stdout.write(`${GRAY}${event.delta}${RESET}`)
    } else if (event.type === 'text_delta') {
      if (printingThinking) {
        process.stdout.write('\n\n')
        printingThinking = false
      }
      process.stdout.write(event.delta)
    }
  }
  const reply = await stream.result()
  process.stdout.write('\n')
  return reply
}

async function main(): Promise<void> {
  const banner = spawnSync('toilet', ['-f', 'mono9', 'Agent'], { stdio: 'inherit' })
  if (banner.error) console.log('MiniAgent')

  const apiKey = loadApiKey('DeepSeek')
  const context: Context = {
    systemPrompt: SYSTEM_PROMPT,
    messages: [],
    tools: [BASH_TOOL],
  }

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
    context.messages.push({ role: 'user', content: userInput, timestamp: Date.now() })

    for (;;) {
      const reply = await readReply(context, apiKey)
      context.messages.push(reply)
      if (reply.stopReason !== 'toolUse') break
      for (const block of reply.content) {
        if (block.type === 'toolCall') {
          const output = runBash((block.arguments as { command: string }).command)
          context.messages.push({
            role: 'toolResult',
            toolCallId: block.id,
            toolName: block.name,
            content: [{ type: 'text', text: output }],
            isError: false,
            timestamp: Date.now(),
          })
        }
      }
    }
  }
}

main()
