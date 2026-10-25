#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

const GRAY = '\x1b[90m'
const CYAN = '\x1b[36m'
const RESET = '\x1b[0m'

const SYSTEM_PROMPT = '使用 bash 完成当前目录下的任务。中文回复。'

const MODEL = 'deepseek-flash'

const CHAT_COMPLETIONS_URL = 'https://api.deepseek.com/chat/completions'

interface Delta {
  reasoning_content?: string
  content?: string
  tool_calls?: {
    index: number
    id?: string
    function?: { name?: string; arguments?: string }
  }[]
}

interface ToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

type Message = Record<string, unknown>

const BASH_TOOL = {
  type: 'function',
  function: {
    name: 'bash',
    description: '在独立、非交互的 bash 进程中执行命令。返回退出码和输出。',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' } },
      required: ['command'],
    },
  },
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

async function* streamDeltas(messages: Message[], apiKey: string): AsyncGenerator<Delta> {
  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      tools: [BASH_TOOL],
      thinking: { type: 'enabled' },
      stream: true,
    }),
  })
  if (!response.ok || !response.body) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`)
  }

  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true })
    let newline: number
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).replace(/\r$/, '')
      buffer = buffer.slice(newline + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      const chunk = JSON.parse(data)
      if (chunk.choices?.length) yield chunk.choices[0].delta
    }
  }
}

async function readReply(messages: Message[], apiKey: string): Promise<Message> {
  const reply: Message = { role: 'assistant', content: '', reasoning_content: '' }
  const toolCalls = new Map<number, ToolCall>()
  for await (const delta of streamDeltas(messages, apiKey)) {
    const reasoning = delta.reasoning_content ?? ''
    const content = delta.content ?? ''

    if (reasoning) {
      reply.reasoning_content = (reply.reasoning_content as string) + reasoning
      process.stdout.write(`${GRAY}${reasoning}${RESET}`)
    }
    if (content) {
      if (!(reply.content as string) && reply.reasoning_content) {
        process.stdout.write('\n\n')
      }
      reply.content = (reply.content as string) + content
      process.stdout.write(content)
    }

    for (const fragment of delta.tool_calls ?? []) {
      const toolCall = toolCalls.get(fragment.index) ?? {
        id: '',
        type: 'function' as const,
        function: { name: '', arguments: '' },
      }
      toolCalls.set(fragment.index, toolCall)
      toolCall.id += fragment.id ?? ''
      toolCall.function.name += fragment.function?.name ?? ''
      toolCall.function.arguments += fragment.function?.arguments ?? ''
    }
  }

  if (toolCalls.size > 0) {
    reply.tool_calls = [...toolCalls.values()]
  }
  process.stdout.write('\n')
  return reply
}

async function main(): Promise<void> {
  const banner = spawnSync('toilet', ['-f', 'mono9', 'Agent'], { stdio: 'inherit' })
  if (banner.error) console.log('MiniAgent')

  const apiKey = loadApiKey('DeepSeek')
  const messages: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }]

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
    messages.push({ role: 'user', content: userInput })

    for (;;) {
      const reply = await readReply(messages, apiKey)
      messages.push(reply)
      if (!reply.tool_calls) break
      for (const toolCall of reply.tool_calls as ToolCall[]) {
        const args = JSON.parse(toolCall.function.arguments)
        const output = runBash(args.command)
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: output })
      }
    }
  }
}

main()
