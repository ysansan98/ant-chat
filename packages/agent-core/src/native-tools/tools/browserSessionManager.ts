import type { AgentBrowserRuntimeConfig } from '@ant-chat/shared'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { runBrowserTool } from './browserRunner'

export interface BrowserSessionState {
  sessionName: string
  socketPath: string
  profilePath: string
  headed: boolean
  started: boolean
  profile?: string
  queue: Promise<void>
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSessionState>()

  constructor(private readonly config: AgentBrowserRuntimeConfig) {}

  get(conversationId: string): BrowserSessionState {
    const existing = this.sessions.get(conversationId)
    if (existing) {
      return existing
    }

    const id = createSessionId(conversationId)
    const sessionName = `ant-chat-${id}`
    const state: BrowserSessionState = {
      sessionName,
      socketPath: path.join(getSocketRoot(), sessionName),
      profilePath: path.join(path.dirname(this.config.profilePath), 'sessions', id, 'profile'),
      headed: false,
      started: false,
      profile: undefined,
      queue: Promise.resolve(),
    }
    this.sessions.set(conversationId, state)
    return state
  }

  async close(conversationId: string, removeProfile: boolean = false): Promise<void> {
    const state = this.sessions.get(conversationId)
    if (!state) {
      return
    }

    await runBrowserTool({ command: 'close' }, {
      ...this.config,
      state,
    })
    if (removeProfile) {
      await fs.promises.rm(path.dirname(state.profilePath), { recursive: true, force: true })
    }
    this.sessions.delete(conversationId)
  }

  async dispose(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(conversationId => this.close(conversationId)))
  }
}

function createSessionId(conversationId: string): string {
  return createHash('sha256').update(conversationId).digest('hex').slice(0, 16)
}

function getSocketRoot(): string {
  if (process.platform === 'darwin') {
    return '/tmp'
  }
  return os.tmpdir()
}
