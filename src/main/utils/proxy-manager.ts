import type { ProxySettings } from '@ant-chat/shared'
import { logger } from '@main/utils/logger'
import { Agent, ProxyAgent, setGlobalDispatcher } from 'undici'
import { GeneralSettingsStore } from '../store/generalSettings'
import { getSystemProxySettings } from './system-proxy'

// 全局代理管理器
export class ProxyManager {
  private static instance: ProxyManager
  private currentSettings: ProxySettings = { mode: 'none' }
  private currentAgent: ProxyAgent | null = null
  private originalDispatcher: typeof globalThis.dispatcher | null = null

  private constructor() {}

  static getInstance(): ProxyManager {
    if (!ProxyManager.instance) {
      ProxyManager.instance = new ProxyManager()
    }
    return ProxyManager.instance
  }

  async updateProxySettings(settings: ProxySettings): Promise<void> {
    this.currentSettings = settings
    await this.applyProxy()
  }

  private getNoProxyList(): string {
    // 本地地址不走代理
    return [
      'localhost', // 本地主机
      '127.0.0.1', // IPv4本地回环
      '::1', // IPv6本地回环
      '192.168.*', // 私有网络A类
      '10.*', // 私有网络B类
      '172.16.*-172.31.*', // 私有网络C类
    ].join(',')
  }

  private async applyProxy(): Promise<void> {
    let proxyUrl: string
    if (this.currentSettings.mode === 'custom') {
      proxyUrl = this.currentSettings.customProxyUrl || ''
    }
    else if (this.currentSettings.mode === 'system') {
      // 系统代理检测逻辑 - 实时获取
      proxyUrl = await this.detectSystemProxy()
    }
    else {
      this.clearProxy()
      return
    }

    if (proxyUrl) {
      try {
        // 创建新的 ProxyAgent
        const newAgent = new ProxyAgent({
          uri: proxyUrl,
          proxyTls: {
            rejectUnauthorized: true,
          },
        })

        // 设置为全局 dispatcher
        setGlobalDispatcher(newAgent)

        // 清理旧的 agent
        if (this.currentAgent) {
          this.currentAgent.close()
        }

        this.currentAgent = newAgent

        // 同时设置环境变量以兼容其他 HTTP 客户端
        process.env.HTTP_PROXY = proxyUrl
        process.env.HTTPS_PROXY = proxyUrl
        process.env.NO_PROXY = this.getNoProxyList()

        logger.info(`Global proxy configured: ${proxyUrl}`)
        logger.info(`Local networks bypass proxy: ${process.env.NO_PROXY}`)
      }
      catch (error) {
        logger.error('Failed to create ProxyAgent:', error)
        this.clearProxy()
      }
    }
  }

  private clearProxy(): void {
    // 恢复原始 dispatcher
    if (this.originalDispatcher) {
      setGlobalDispatcher(this.originalDispatcher)
    }
    else {
      // 如果没有保存原始 dispatcher，则创建默认的
      setGlobalDispatcher(new Agent())
    }

    // 清理当前 agent
    if (this.currentAgent) {
      this.currentAgent.close()
      this.currentAgent = null
    }

    // 清理环境变量
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    delete process.env.NO_PROXY

    logger.info('Proxy cleared')
  }

  private async detectSystemProxy(): Promise<string> {
    return await getSystemProxySettings()
  }

  // 从主进程存储初始化代理设置
  async initializeFromStorage(): Promise<void> {
    // 保存原始 dispatcher
    if (!this.originalDispatcher) {
      this.originalDispatcher = globalThis.dispatcher
    }

    const settings = GeneralSettingsStore.getInstance().getSettings()
    await this.updateProxySettings(settings.proxySettings)
  }

  // 获取当前代理设置
  getCurrentSettings(): ProxySettings {
    return { ...this.currentSettings }
  }

  // 获取当前实际使用的代理URL（包括系统代理）
  async getCurrentProxyUrl(): Promise<string> {
    if (this.currentSettings.mode === 'none') {
      return ''
    }

    if (this.currentSettings.mode === 'custom') {
      return this.currentSettings.customProxyUrl || ''
    }

    if (this.currentSettings.mode === 'system') {
      return await this.detectSystemProxy()
    }

    return ''
  }

  // 清理代理设置
  cleanup(): void {
    this.clearProxy()
    this.currentSettings = { mode: 'none' }
    this.originalDispatcher = null
    logger.info('ProxyManager cleaned up')
  }
}

// 初始化时应用代理设置
export async function initializeProxy(): Promise<void> {
  await ProxyManager.getInstance().initializeFromStorage()
}
