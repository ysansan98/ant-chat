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
  /** 清除应用托管登录态后，旧 Turn 不能继续复用该会话。 */
  invalidated?: boolean
  queue: Promise<void>
}

export class BrowserSessionManager {
  private readonly sessions = new Map<string, BrowserSessionState>()
  private readonly retiredSessions = new Map<string, BrowserSessionState[]>()
  private readonly unsubscribeFromClear?: () => void

  constructor(
    private readonly config: AgentBrowserRuntimeConfig,
    private readonly authStateProvider?: BrowserAuthStateProvider,
  ) {
    this.unsubscribeFromClear = authStateProvider?.onClear?.(() => this.invalidateAll())
  }

  get(conversationId: string): BrowserSessionState {
    const existing = this.sessions.get(conversationId)
    const generation = this.authStateProvider?.getGeneration() ?? 0
    if (existing && !existing.invalidated && existing.authGeneration === generation) {
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
      await this.closeState(state, removeProfile)
    }
    this.sessions.delete(conversationId)
    this.retiredSessions.delete(conversationId)
  }

  async dispose(): Promise<void> {
    this.unsubscribeFromClear?.()
    await Promise.all([...new Set([...this.sessions.keys(), ...this.retiredSessions.keys()])].map(conversationId => this.close(conversationId, true)))
  }

  private async invalidateAll(): Promise<void> {
    const states = this.getAllStates()
    for (const state of states) {
      state.invalidated = true
      state.authCookies = undefined
      state.authCookieDomains?.clear()
    }

    await Promise.all(states.map(state => this.closeState(state, true).catch(() => {})))

    for (const [conversationId, state] of this.sessions) {
      if (states.includes(state))
        this.sessions.delete(conversationId)
    }
    for (const [conversationId, retired] of this.retiredSessions) {
      const remaining = retired.filter(state => !states.includes(state))
      if (remaining.length === 0)
        this.retiredSessions.delete(conversationId)
      else
        this.retiredSessions.set(conversationId, remaining)
    }
  }

  private getAllStates(): BrowserSessionState[] {
    return [...new Set([
      ...this.sessions.values(),
      ...[...this.retiredSessions.values()].flat(),
    ])]
  }

  private async closeState(state: BrowserSessionState, removeProfile: boolean): Promise<void> {
    try {
      await runBrowserTool({ command: 'close' }, {
        ...this.config,
        state,
        authStateProvider: this.authStateProvider,
      })
    }
    finally {
      if (removeProfile)
        await fs.promises.rm(path.dirname(state.profilePath), { recursive: true, force: true })
    }
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
