import { beforeEach, describe, expect, it } from 'vitest'
import { updateMessage } from '../message'
import { createMessage } from './factory'
import { canRunDbIntegrationTests, mockDb } from './utils'

const describeDb = canRunDbIntegrationTests() ? describe : describe.skip

describeDb('message service', () => {
  beforeEach(async () => {
    await mockDb()
  })

  describe('updateMessage', () => {
    it('更新包含error的content', async () => {
      let message = await createMessage({
        id: 'msg-XiOPzFnYVNEgTCj3h7csb',
        convId: 'conv-otDibEPk_83HIQ-EgO4ZK',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'old text',
          } as const,
        ],
        createdAt: 1748395533791,
        status: 'error',
        images: [],
        attachments: [],
        reasoningContent: null,
        mcpTool: null,
        modelInfo: { provider: 'DeepSeek', model: 'deepseek-chat' },
      })
      const updatedContent = [...message.content, { type: 'error', error: 'new error' } as const]
      message = await updateMessage({
        id: message.id,
        content: updatedContent,
      })

      expect(message.content).toEqual([
        { type: 'text', text: 'old text' },
        { type: 'error', error: 'new error' },
      ])
    })
  })
})
