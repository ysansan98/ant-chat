import type { InferSelectModel } from 'drizzle-orm'
import type { MultiProvider } from './multi-provider'
import { createAProvider } from './multi-provider'

/**
 * AI Provider 工厂函数
 * 根据服务商配置创建对应的 AI Provider 实例
 */
export async function createProvider(provider: InferSelectModel<typeof import('../db/schema').serviceProviderTable>): Promise<MultiProvider> {
  return createAProvider(provider)
}
