import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { NetworkProxyManager } from '../../../networkProxy'
import { Method, Module } from '../../decorators'

@Module('settings')
export class SettingsModule implements RuntimeModuleMethods<'settings'> {
  private readonly networkProxy = new NetworkProxyManager()

  constructor(private readonly core: Pick<RuntimeCore, 'data' | 'events'>) {}

  async initialize() {
    const settings = await this.core.data.settingsRepository.getGeneralSettings()
    await this.networkProxy.apply(settings.proxySettings)
  }

  dispose() {
    return this.networkProxy.dispose()
  }

  @Method()
  getSettings(_input?: AppRpcInput<'settings.getSettings'>) {
    return this.core.data.settingsRepository.getGeneralSettings()
  }

  @Method()
  async updateSettings(input: AppRpcInput<'settings.updateSettings'>) {
    const { updates } = input
    if (!updates.proxySettings) {
      const settings = await this.core.data.settingsRepository.updateGeneralSettings(updates)
      this.core.events.emit('settings:updated', { keys: Object.keys(updates) })
      return settings
    }

    const currentSettings = await this.core.data.settingsRepository.getGeneralSettings()
    await this.networkProxy.apply(updates.proxySettings)
    try {
      const settings = await this.core.data.settingsRepository.updateGeneralSettings(updates)
      this.core.events.emit('settings:updated', { keys: Object.keys(updates) })
      return settings
    }
    catch (persistError) {
      try {
        await this.networkProxy.apply(currentSettings.proxySettings)
      }
      catch {
        // 恢复失败时保留最初的持久化错误，避免掩盖根因。
      }
      throw persistError
    }
  }

  @Method()
  async resetSettings(_input: AppRpcInput<'settings.resetSettings'>) {
    const settings = await this.core.data.settingsRepository.resetGeneralSettings()
    await this.networkProxy.apply(settings.proxySettings)
    this.core.events.emit('settings:updated', { keys: ['all'] })
    return settings
  }

  @Method()
  testProxyConnection(input: AppRpcInput<'settings.testProxyConnection'>) {
    return this.networkProxy.test(input.proxyUrl)
  }
}
