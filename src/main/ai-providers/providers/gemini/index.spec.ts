import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  IAttachment,
  IMcpToolCall,
  IMessage,
  SendChatCompletionsOptions,
} from '@ant-chat/shared'
import type { AIProvider, ProviderOptions } from '../interface'
import GeminiService from './index'

vi.mock('@google/genai', () => ({
  GoogleGenAI: class MockGoogleGenAI {
    models!: {
      generateContentStream: ReturnType<typeof vi.fn>
    }

    constructor() {
      this.models = {
        generateContentStream: vi.fn(),
      }
    }
  },
}))

vi.mock('@main/utils/util', () => ({
  getAppHand: vi.fn().mockReturnValue(''),
}))

const mockOptions: ProviderOptions = {
  apiKey: 'fake-key',
  baseUrl: 'https://fake-url',
}

const baseMsg = {
  id: 'msg1',
  convId: 'conv1',
  createdAt: Date.now(),
}

describe('test GeminiService', () => {
  let service: AIProvider

  beforeEach(() => {
    service = new GeminiService(mockOptions)
  })

  it('用户文本消息能被正确转换', () => {
    const messages: IMessage[] = [
      {
        ...baseMsg,
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
        images: [],
        attachments: [],
        status: 'success',
      },
    ]
    const result = (service as any).transformMessages(messages)
    expect(result[0].role).toBe('user')
    expect(result[0].parts[0].text).toBe('hello')
  })

  it('助手文本和图片消息能被正确转换', () => {
    const messages: IMessage[] = [
      {
        ...baseMsg,
        role: 'assistant',
        content: [
          { type: 'text', text: 'hi' },
          { type: 'image', mimeType: 'image/png', data: 'base64data' },
        ],
        status: 'success',
      },
    ]
    const result = (service as any).transformMessages(messages)
    expect(result[0].role).toBe('assistant')
    expect(result[0].parts[0].text).toBe('hi')
    expect(result[0].parts[1].inlineData.mimeType).toBe('image/png')
  })

  it('文件附件能被正确转换', () => {
    const attachments: IAttachment[] = [
      {
        uid: '1',
        name: 'img.png',
        size: 123,
        type: 'image/png',
        data: 'data:image/png;base64,abc123',
      },
    ]
    const result = (service as any).transformFilePart(attachments)
    expect(result[0].inlineData.mimeType).toBe('image/png')
    expect(result[0].inlineData.data).toBe('abc123')
  })

  it('mCP 工具调用能被正确转换', () => {
    const mcpTools: IMcpToolCall[] = [
      {
        id: 'id1',
        serverName: 'server',
        toolName: 'tool',
        args: { foo: 'bar' },
        executeState: 'completed',
        result: { success: true, data: 'ok' },
      },
    ]
    const result = (service as any).transformMcpToolToMessage(mcpTools)
    expect(result[0].parts[0].functionCall).toBeDefined()
    expect(result[1].parts[0].functionResponse).toBeDefined()
  })

  it('sendChatCompletions 能正确产出格式化结果', async () => {
    const fakeStream = (async function* () {
      yield {
        candidates: [{ content: { parts: [{ text: 'response' }] } }],
      }
    })()

    // @ts-expect-error: mockResolvedValue is a mock property from vi.fn()
    service.client.models.generateContentStream.mockResolvedValue(fakeStream)
    const options: SendChatCompletionsOptions = {
      messages: [
        {
          ...baseMsg,
          role: 'user',
          content: [{ type: 'text', text: 'hi' }],
          images: [],
          attachments: [],
          status: 'success',
        },
      ],
      chatSettings: {
        model: 'test-model',
        temperature: 0.5,
        maxTokens: 100,
        systemPrompt: '',
        features: { onlineSearch: false, enableMCP: false },
      },
    }
    const results: any[] = []
    for await (const chunk of service.sendChatCompletions(options)) {
      results.push(chunk)
    }
    expect(results[0].content[0].text).toBe('response')
  })
})
