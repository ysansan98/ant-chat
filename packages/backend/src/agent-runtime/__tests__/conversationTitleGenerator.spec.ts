import type { IAIProvider, IConversations, IMessage, ProviderConfigModelSchema, ProviderConfigSchema } from '@ant-chat/shared'
import { describe, expect, it, vi } from 'vitest'
import { createConversationTitleGenerator } from '../conversationTitleGenerator'

const provider = {
  id: 'provider-1',
  name: 'Provider',
  baseUrl: 'https://opencode.ai/zen/go/v1',
  apiMode: 'openai',
  integrationId: 'api-key',
  isOfficial: false,
  isEnabled: true,
  createdAt: 1,
  updatedAt: 1,
} as ProviderConfigSchema

const model = {
  id: 'model-1',
  model: 'opencode-go',
  name: 'OpenCode Go',
  providerId: 'provider-1',
  maxOutputTokens: 4096,
  contextLength: 128_000,
  temperature: 0,
} as ProviderConfigModelSchema

const message: IMessage = {
  id: 'm1',
  convId: 'conv-42',
  role: 'user',
  status: 'success',
  content: [{ type: 'text', text: '把待处理队列下沉到后端' }],
  createdAt: 1,
  turnId: 'turn-1',
}

const conversation = {
  id: 'conv-42',
  title: 'Untitled',
  workspacePath: '/workspace',
  createdAt: 1,
  updatedAt: 1,
  conversationInstructions: '',
  settings: { modelId: 'model-1', providerId: 'provider-1' },
} as IConversations

describe('conversationTitleGenerator', () => {
  it('标题生成把 conversationId 透传给 complete，供 OpenCode 会话头使用', async () => {
    const complete = vi.fn<IAIProvider['complete']>(async () => ({ text: '待处理队列下沉' }))
    const updateConversation = vi.fn(async (input: { id: string, title: string }) => ({ ...conversation, ...input }))
    const aiProviderFactory = vi.fn(async () => ({ complete } as unknown as IAIProvider))

    const generator = createConversationTitleGenerator({
      providerSettingsRepository: {
        getProviderById: vi.fn(() => provider),
        getModel: vi.fn(() => model),
      } as never,
      messageRepository: {
        listByConversation: vi.fn(async () => [message]),
      } as never,
      updateConversation: updateConversation as never,
      aiProviderFactory,
    })

    await generator.updateTitle('conv-42', { providerId: 'provider-1', modelId: 'model-1' })

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'conv-42',
    }))
    expect(updateConversation).toHaveBeenCalledWith({ id: 'conv-42', title: '待处理队列下沉' })
  })
})
