/**
 * 会话的 JSONL 落盘：每个会话一个文件，首行信封 {"version":1,"id":...}，其后每行一条消息。
 * save 为原子写（tmp + rename）；list 容错跳过坏文件，不让单个坏文件拖垮全局。
 */
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { SessionNotFoundError } from '../../app/ports.ts'
import type { SessionStore } from '../../app/ports.ts'
import { Session, isSessionId, messageFromJSON } from '../../domain/session.ts'
import type { SessionJSON } from '../../domain/session.ts'

export class JsonlSessionStore implements SessionStore {
  readonly root: string

  constructor(root: string) {
    this.root = root
    mkdirSync(root, { recursive: true })
  }

  #path(sessionId: string): string {
    // id 校验同时挡住路径穿越；不合法的 id 一律按「会话不存在」处理。
    if (!isSessionId(sessionId)) throw new SessionNotFoundError(sessionId)
    return join(this.root, `${sessionId}.jsonl`)
  }

  async save(session: Session): Promise<void> {
    const target = this.#path(session.id)
    const temporary = `${target}.tmp`
    writeFileSync(temporary, dump(session), 'utf8')
    renameSync(temporary, target)
  }

  async load(sessionId: string): Promise<Session> {
    const path = this.#path(sessionId)
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      throw new SessionNotFoundError(sessionId)
    }
    return parse(text, sessionId)
  }

  async list(): Promise<readonly Session[]> {
    const sessions: Session[] = []
    for (const file of this.files()) {
      try {
        sessions.push(parse(readFileSync(join(this.root, file), 'utf8')))
      } catch {
        // 坏文件不参与列表；扩展点：只读首行即可得到 id 与消息数，避免全量解析。
      }
    }
    return sessions
  }

  files(): string[] {
    return readdirSync(this.root).filter((name) => name.endsWith('.jsonl')).sort()
  }
}

export function dump(session: Session): string {
  const envelope: SessionJSON = session.toJSON()
  const lines = [JSON.stringify({ version: envelope.version, id: envelope.id })]
  lines.push(...envelope.messages.map((message) => JSON.stringify(message)))
  return `${lines.join('\n')}\n`
}

export function parse(text: string, expectedId?: string): Session {
  const lines = text.split('\n').filter((line) => line.trim() !== '')
  if (lines.length === 0) throw new Error('bad session file: empty')
  let envelope: { version?: unknown; id?: unknown }
  try {
    envelope = JSON.parse(lines[0])
  } catch {
    throw new Error('bad session file: broken header')
  }
  if (envelope['version'] !== 1 || typeof envelope['id'] !== 'string') {
    throw new Error('bad session file: unexpected header')
  }
  if (expectedId !== undefined && envelope['id'] !== expectedId) {
    throw new Error(`bad session file: id mismatch (${envelope['id']} != ${expectedId})`)
  }
  const messages = lines.slice(1).map((line) => messageFromJSON(JSON.parse(line)))
  return Session.fromJSON({ version: envelope['version'], id: envelope['id'], messages })
}
