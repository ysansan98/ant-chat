import { nanoid } from 'nanoid'
import { getDb } from '../../db'
import { conversationsTable, messagesTable, serviceProviderModelsTable, serviceProviderTable } from '../../schema'

// 插入 providerServices 测试数据
export async function createProviderService(data: Partial<typeof serviceProviderTable.$inferInsert> = {}): Promise<any> {
  const defaultData = {
    id: `provider-${nanoid()}`,
    name: 'Test Service',
    baseUrl: 'http://localhost',
    apiMode: 'openai' as const,
    isOfficial: false,
    isEnabled: true,
    createdAt: Math.floor(Date.now() / 1000),
    updatedAt: Math.floor(Date.now() / 1000),
  }
  const insertData = { ...defaultData, ...data }
  const [row] = await getDb().insert(serviceProviderTable).values(insertData).returning()
  return row
}

// 插入 serviceProviderModels 测试数据
export async function createProviderServiceModel(data: Partial<typeof serviceProviderModelsTable.$inferInsert> = {}): Promise<any> {
  const defaultData = {
    id: nanoid(),
    name: 'Test Model',
    model: 'test-model',
    isBuiltin: false,
    isEnabled: true,
    modelFeatures: null,
    serviceProviderId: data.serviceProviderId || `provider-${nanoid()}`,
    createdAt: Math.floor(Date.now() / 1000),
  }
  const insertData = { ...defaultData, ...data }
  const [row] = await getDb().insert(serviceProviderModelsTable).values(insertData).returning()
  return row
}

export async function createMessage(data: Partial<typeof messagesTable.$inferInsert> = {}): Promise<any> {
  const defaultData = {
    id: `msg-${nanoid()}`,
    content: [{ type: 'text', text: 'Test Message' } as const],
    role: 'user',
    status: 'success',
    convId: `conv-${nanoid()}`,
  }
  const insertData = { ...defaultData, ...data }
  const [row] = await getDb().insert(messagesTable).values(insertData).returning()
  return row
}

export async function createConversation(data: Partial<typeof conversationsTable.$inferInsert> = {}): Promise<any> {
  const now = Math.floor(Date.now() / 1000)
  const defaultData = {
    id: `conv-${nanoid()}`,
    title: 'Test Conversation',
    createdAt: now,
    updatedAt: now,
    settings: {
      modelId: 'test-model',
      systemPrompt: '',
      temperature: 0.7,
      maxTokens: 1024,
    },
  }
  const insertData = { ...defaultData, ...data }
  const [row] = await getDb().insert(conversationsTable).values(insertData).returning()
  return row
}
