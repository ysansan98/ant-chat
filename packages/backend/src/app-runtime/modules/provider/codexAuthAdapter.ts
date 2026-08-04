import type { ProviderAuthStatus, ProviderConfigSchema } from '@ant-chat/shared'
import type { CodexAuthSession, CodexOAuthCoordinator } from '../../../agent-core/ai-providers/codex'
import type { ProviderAuthAdapter } from './providerIntegration'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { parseCodexCliAuth } from '../../../agent-core/ai-providers/codex'

export class CodexAuthAdapter implements ProviderAuthAdapter {
  constructor(
    private readonly options: {
      getAuthSession: (provider: ProviderConfigSchema) => CodexAuthSession
      getOAuthCoordinator: (provider: ProviderConfigSchema) => CodexOAuthCoordinator
      getOAuthCoordinators: () => Iterable<CodexOAuthCoordinator>
    },
  ) {}

  startLogin(provider: ProviderConfigSchema, redirectUri: string): { authorizationUrl: string } {
    return this.options.getOAuthCoordinator(provider).start(provider.id, redirectUri)
  }

  async handleCallback(params: URLSearchParams): Promise<boolean> {
    for (const coordinator of this.options.getOAuthCoordinators()) {
      const handled = await coordinator.consumeCallback(params)
      if (handled) {
        return true
      }
    }
    return false
  }

  async importLocalAuth(provider: ProviderConfigSchema): Promise<ProviderAuthStatus> {
    const authPath = getCodexCliAuthPath()
    let raw: string
    try {
      raw = await readFile(authPath, 'utf8')
    }
    catch (error) {
      throw new Error(`读取本机 Codex CLI 凭据失败（${authPath}）：${error instanceof Error ? error.message : String(error)}`)
    }
    const credentials = parseCodexCliAuth(raw)
    if (!credentials) {
      throw new Error(`本机 Codex CLI 凭据格式无效（${authPath}）。`)
    }
    await this.options.getAuthSession(provider).save(credentials)
    return await this.getStatus(provider)
  }

  async getStatus(provider: ProviderConfigSchema): Promise<ProviderAuthStatus> {
    return await this.options.getAuthSession(provider).getAuthStatus()
  }

  async logout(provider: ProviderConfigSchema): Promise<void> {
    this.options.getOAuthCoordinator(provider).invalidate()
    await this.options.getAuthSession(provider).logout()
  }

  dispose(): void {
    for (const coordinator of this.options.getOAuthCoordinators()) {
      coordinator.dispose()
    }
  }
}

function getCodexCliAuthPath(): string {
  return join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'auth.json')
}
