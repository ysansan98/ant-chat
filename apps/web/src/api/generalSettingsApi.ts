import type { GeneralSettingsState } from '@ant-chat/shared'
import { skipNextSettingsRefresh } from '@/store/generalSettings/actions'
import { getAppRpcClient } from './transports/appRpc'

export interface GeneralSettingsAPI {
  getSettings: () => Promise<GeneralSettingsState>
  updateSettings: (updates: Partial<GeneralSettingsState>) => Promise<GeneralSettingsState>
  resetSettings: () => Promise<GeneralSettingsState>
}

export const generalSettingsApi: GeneralSettingsAPI = {
  getSettings: async () => {
    return getAppRpcClient().call('settings.getSettings', undefined)
  },

  /**
   * 后端 updateSettings 响应已返回完整数据（调用方直接 setState），
   * 但后端同时 emit settings:updated 事件会触发 refreshGeneralSettings GET。
   * 标记跳过，避免同一窗口产生 2 次请求。
   */
  updateSettings: async (updates: Partial<GeneralSettingsState>) => {
    const result = await getAppRpcClient().call('settings.updateSettings', { updates })
    // 在 RPC 成功返回后设置（抛异常则不设，避免误跳过）
    skipNextSettingsRefresh()
    return result
  },

  resetSettings: async () => {
    const result = await getAppRpcClient().call('settings.resetSettings', undefined)
    skipNextSettingsRefresh()
    return result
  },
}
