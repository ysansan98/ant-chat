import { db } from './db'
import { serviceProviderModelsTable, serviceProviderTable } from './schema'

const providerServiceData = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com', apiMode: 'openai' as const, isOfficial: true },
  { id: 'gemini', name: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiMode: 'gemini' as const, isOfficial: true },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com', apiMode: 'anthropic' as const, isOfficial: true },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiMode: 'deepseek' as const, isOfficial: true },
  { id: 'alibaba', name: '阿里巴巴', baseUrl: 'https://dashscope.aliyuncs.com/api/v1', apiMode: 'openai' as const, isOfficial: false },
  { id: 'zhipu', name: '智谱 AI', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiMode: 'openai' as const, isOfficial: false },
  { id: 'moonshot', name: '月之暗面', baseUrl: 'https://api.moonshot.cn', apiMode: 'openai' as const, isOfficial: false },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.chat/v1', apiMode: 'openai' as const, isOfficial: false },
] as const

const providerServiceModelsData = []

export async function initializeData() {
  db.transaction((tx) => {
    providerServiceData.forEach((row) => {
      tx.insert(serviceProviderTable).values(row).onConflictDoNothing({ target: serviceProviderTable.id }).run()
    })

    // 清空模型数组（为 models.dev 集成预留空间）
    if (providerServiceModelsData.length > 0) {
      providerServiceModelsData.forEach((row: any) => {
        tx.insert(serviceProviderModelsTable)
          .values({ ...row })
          .onConflictDoUpdate({
            target: [serviceProviderModelsTable.model, serviceProviderModelsTable.serviceProviderId],
            set: {
              id: row.id,
              name: row.name,
              modelFeatures: row.modelFeatures,
              isBuiltin: row.isBuiltin,
              isEnabled: row.isEnabled,
              maxTokens: row.maxTokens,
              temperature: row.temperature,
              contextLength: row.contextLength,
              serviceProviderId: row.serviceProviderId,
            },
          })
          .run()
      })
    }
  })
}
