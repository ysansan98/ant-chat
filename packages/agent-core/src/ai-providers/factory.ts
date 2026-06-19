import type { ILogger, ProviderConfigSchema } from '@ant-chat/shared'
import type { MultiProvider } from './multi-provider'
import { createAProvider } from './multi-provider'

export interface CreateProviderOptions {
  logger?: ILogger
}

/**
 * AI Provider 工厂函数
 * 根据服务商配置创建对应的 AI Provider 实例
 */
export async function createProvider(provider: ProviderConfigSchema, options: CreateProviderOptions = {}): Promise<MultiProvider> {
  return createAProvider(provider, options)
}
