import type { ILogger, ProviderConfigSchema } from '@ant-chat/shared'
import type { MultiProvider } from './multi-provider'
import type { ClientInfo } from './requestHeaders'
import { createAProvider } from './multi-provider'

export interface CreateProviderOptions {
  logger?: ILogger
  /** 宿主身份，用于统一出站请求的 User-Agent。 */
  clientInfo?: ClientInfo
}

/**
 * AI Provider 工厂函数
 * 根据服务商配置创建对应的 AI Provider 实例
 */
export async function createProvider(provider: ProviderConfigSchema, options: CreateProviderOptions = {}): Promise<MultiProvider> {
  return createAProvider(provider, options)
}
