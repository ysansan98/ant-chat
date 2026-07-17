import type { ProxySettings } from '@ant-chat/shared'
import type { Dispatcher } from 'undici'
import { createRequire } from 'node:module'
import process from 'node:process'
import { Agent, EnvHttpProxyAgent, fetch, getGlobalDispatcher, setGlobalDispatcher } from 'undici'

const noProxy = 'localhost,127.0.0.1,0.0.0.0,[::1],::1'
const proxyEnvKeys = [
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
] as const

type ProxyEnvKey = typeof proxyEnvKeys[number]
type ProxyEnvironment = Partial<Record<ProxyEnvKey, string>>

export class NetworkProxyManager {
  private readonly initialDispatcher = getGlobalDispatcher()
  private readonly initialEnvironment = readProxyEnvironment()
  private currentDispatcher: Dispatcher | null = null

  async apply(settings: ProxySettings): Promise<void> {
    if (settings.mode === 'custom') {
      // URL 为空时不抛异常，仅不启用代理——前端"自定义"模式可先展示输入框再填 URL
      if (settings.customProxyUrl) {
        await this.applyCustomProxy(settings.customProxyUrl)
      }
      else {
        clearProxyEnvironment()
        await this.replaceDispatcher(new Agent())
      }
      return
    }

    if (settings.mode === 'system') {
      const systemProxyUrl = await resolveElectronSystemProxy()
      if (systemProxyUrl) {
        await this.applyCustomProxy(systemProxyUrl)
        return
      }
      this.restoreEnvironment()
      await this.replaceDispatcher(new EnvHttpProxyAgent())
      return
    }

    clearProxyEnvironment()
    await this.replaceDispatcher(new Agent())
  }

  async test(proxyUrl: string): Promise<boolean> {
    const dispatcher = new EnvHttpProxyAgent({
      httpProxy: proxyUrl,
      httpsProxy: proxyUrl,
    })
    try {
      const response = await fetch('https://www.google.com/generate_204', {
        dispatcher,
        signal: AbortSignal.timeout(10_000),
      })
      return response.ok
    }
    catch {
      return false
    }
    finally {
      await dispatcher.close()
    }
  }

  async dispose(): Promise<void> {
    setGlobalDispatcher(this.initialDispatcher)
    this.restoreEnvironment()
    await this.closeCurrentDispatcher()
  }

  private async applyCustomProxy(proxyUrl: string): Promise<void> {
    setProxyEnvironment(proxyUrl)
    await this.replaceDispatcher(new EnvHttpProxyAgent({
      httpProxy: proxyUrl,
      httpsProxy: proxyUrl,
      noProxy,
      proxyTls: {
        rejectUnauthorized: true,
      },
    }))
  }

  private async replaceDispatcher(dispatcher: Dispatcher): Promise<void> {
    const previousDispatcher = this.currentDispatcher
    this.currentDispatcher = dispatcher
    setGlobalDispatcher(dispatcher)
    if (previousDispatcher)
      await previousDispatcher.close()
  }

  private async closeCurrentDispatcher(): Promise<void> {
    if (!this.currentDispatcher)
      return
    await this.currentDispatcher.close()
    this.currentDispatcher = null
  }

  private restoreEnvironment(): void {
    clearProxyEnvironment()
    for (const [key, value] of Object.entries(this.initialEnvironment))
      process.env[key] = value
  }
}

function readProxyEnvironment(): ProxyEnvironment {
  return Object.fromEntries(
    proxyEnvKeys
      .map(key => [key, process.env[key]] as const)
      .filter((entry): entry is [ProxyEnvKey, string] => entry[1] !== undefined),
  )
}

function setProxyEnvironment(proxyUrl: string): void {
  process.env.HTTP_PROXY = proxyUrl
  process.env.HTTPS_PROXY = proxyUrl
  process.env.NO_PROXY = noProxy
  process.env.http_proxy = proxyUrl
  process.env.https_proxy = proxyUrl
  process.env.no_proxy = noProxy
}

function clearProxyEnvironment(): void {
  for (const key of proxyEnvKeys)
    delete process.env[key]
}

async function resolveElectronSystemProxy(): Promise<string | undefined> {
  if (!process.versions.electron)
    return undefined

  const require = createRequire(import.meta.url)
  const electron = require('electron') as {
    session: {
      defaultSession: {
        resolveProxy: (url: string) => Promise<string>
      }
    }
  }
  const proxyResult = await electron.session.defaultSession.resolveProxy('https://api.openai.com')
  return parseProxyResult(proxyResult)
}

export function parseProxyResult(proxyResult: string): string | undefined {
  for (const entry of proxyResult.split(';')) {
    const match = entry.trim().match(/^(PROXY|HTTPS?|SOCKS|SOCKS4|SOCKS5)\s+([^\s:]+):(\d+)$/i)
    if (!match)
      continue
    const [, , host, port] = match
    return `http://${host}:${port}`
  }
  return undefined
}
