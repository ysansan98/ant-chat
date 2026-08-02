import type { AgentBrowserRuntimeConfig, BrowserAuthStateProvider, BrowserCookie } from '@ant-chat/shared'
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
  authGeneration?: number
  authCookies?: BrowserCookie[]
  authCookieDomains?: Set<string>
  queue: Promise<void>
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSessionState>()
  private readonly retiredSessions = new Map<string, BrowserSessionState[]>()

  constructor(
    private readonly config: AgentBrowserRuntimeConfig,
    private readonly authStateProvider?: BrowserAuthStateProvider,
  ) {}

  get(conversationId: string): BrowserSessionState {
    const existing = this.sessions.get(conversationId)
    const generation = this.authStateProvider?.getGeneration() ?? 0
    if (existing && existing.authGeneration === generation) {
      return existing
    }

    if (existing) {
      const retired = this.retiredSessions.get(conversationId) ?? []
      retired.push(existing)
      this.retiredSessions.set(conversationId, retired)
    }

    const id = createSessionId(conversationId)
    const sessionName = `ant-chat-${id}-g${generation}`
    const state: BrowserSessionState = {
      sessionName,
      socketPath: path.join(getSocketRoot(), sessionName),
      profilePath: path.join(path.dirname(this.config.profilePath), 'sessions', `${id}-g${generation}`, 'profile'),
      headed: false,
      started: false,
      profile: undefined,
      authGeneration: generation,
      authCookies: this.authStateProvider?.getCookies() ?? undefined,
      authCookieDomains: new Set(),
      queue: Promise.resolve(),
    }
    this.sessions.set(conversationId, state)
    return state
  }

  async close(conversationId: string, removeProfile: boolean = false): Promise<void> {
    const states = [
      this.sessions.get(conversationId),
      ...(this.retiredSessions.get(conversationId) ?? []),
    ].filter((value): value is BrowserSessionState => Boolean(value))
    if (states.length === 0) {
      return
    }

    for (const state of states) {
      await runBrowserTool({ command: 'close' }, {
        ...this.config,
        state,
        authStateProvider: this.authStateProvider,
      })
      if (removeProfile) {
        await fs.promises.rm(path.dirname(state.profilePath), { recursive: true, force: true })
      }
    }
    this.sessions.delete(conversationId)
    this.retiredSessions.delete(conversationId)
  }

  async dispose(): Promise<void> {
    await Promise.all([...new Set([...this.sessions.keys(), ...this.retiredSessions.keys()])].map(conversationId => this.close(conversationId, true)))
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
