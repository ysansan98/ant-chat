import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IMessage } from '@ant-chat/shared'
import type { ProviderOptions } from '../interface'
import OpenAIService from './index'

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  })),
}))

vi.mock('@main/mcpClientHub', () => ({
  clientHub: {
    getAllAvailableToolsList: vi.fn(() => []),
  },
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
  },
}))

const mockOptions: ProviderOptions = {
  apiKey: 'fake-key',
  baseUrl: 'https://api.openai.com',
}

const baseMsg = {
  id: 'msg1',
  convId: 'conv1',
  createdAt: Date.now(),
  content: [],
  status: 'success' as const,
}

describe('openAIService', () => {
  let service: OpenAIService

  beforeEach(() => {
    service = new OpenAIService(mockOptions)
  })

  describe('transformMessages', () => {
    it('用户文本消息能被正确转换', () => {
      const messages: IMessage[] = [
        {
          ...baseMsg,
          role: 'user',
          content: [{ type: 'text', text: '你好，世界！' }],
        },
      ]

      const result = (service as any).transformMessages(messages)

      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('user')
      expect(Array.isArray(result[0].content)).toBe(true)
      expect(result[0].content).toHaveLength(1)
      expect(result[0].content[0]).toEqual({
        type: 'text',
        text: '你好，世界！',
      })
    })

    it('用户包含文本、图片和文件的消息能被正确转换', () => {
      const messages: IMessage[] = [
        {
          ...baseMsg,
          role: 'user',
          content: [
            { type: 'text', text: '这是一张图片：' },
          ],
          images: [
            {
              type: 'image/png',
              name: 'picture.png',
              data: 'data:image/png;base64,iVBORw0KGgoAAAANS...',
              uid: 'img1',
              size: 1024,
            },
          ],
          attachments: [
            {
              uid: 'pdf1',
              name: 'document.pdf',
              size: 2048,
              type: 'application/pdf',
              data: 'data:application/pdf;base64,JVBERi0xLjQKJcfs...',
            },
          ],
        },
      ]

      const result = (service as any).transformMessages(messages)

      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('user')
      expect(Array.isArray(result[0].content)).toBe(true)
      expect(result[0].content).toHaveLength(3)
      expect(result[0].content[0]).toEqual({
        type: 'text',
        text: '这是一张图片：',
      })
      expect(result[0].content[1]).toEqual({
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,iVBORw0KGgoAAAANS...' },
      })

      expect(result[0].content[2]).toEqual({
        type: 'file',
        file: {
          filename: 'document.pdf',
          file_data: 'data:application/pdf;base64,JVBERi0xLjQKJcfs...',
        },
      })
    })

    it('助手文本消息能被正确转换', () => {
      const messages: IMessage[] = [
        {
          ...baseMsg,
          role: 'assistant',
          content: [{ type: 'text', text: '您好！有什么我可以帮助您的吗？' }],
        },
      ]

      const result = (service as any).transformMessages(messages)

      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('assistant')
      expect(Array.isArray(result[0].content)).toBe(true)
      expect(result[0].content).toHaveLength(1)
      expect(result[0].content[0]).toEqual({
        type: 'text',
        text: '您好！有什么我可以帮助您的吗？',
      })
    })

    it('助手消息包含 MCP 工具调用时能被正确转换', () => {
      const messages: IMessage[] = [
        {
          ...baseMsg,
          role: 'assistant',
          content: [{ type: 'text', text: '我需要调用一个工具来帮助您。' }],
          mcpTool: [
            {
              id: 'tool_1',
              serverName: 'weather-server',
              toolName: 'get_weather',
              args: { city: '北京', unit: 'celsius' },
              executeState: 'completed',
              result: { success: true, data: '北京今天晴天，温度25°C' },
            },
            {
              id: 'tool_2',
              serverName: 'news-server',
              toolName: 'get_latest_news',
              args: { category: 'tech' },
              executeState: 'await',
            },
          ],
        },
      ]

      const result = (service as any).transformMessages(messages)

      expect(result).toHaveLength(2) // 1个assistant消息 + 1个tool消息（只有完成的工具）

      // 检查第一个消息（助手消息）
      expect(result[0].role).toBe('assistant')
      expect(Array.isArray(result[0].content)).toBe(true)
      expect(result[0].content).toHaveLength(1)
      expect(result[0].content[0]).toEqual({
        type: 'text',
        text: '我需要调用一个工具来帮助您。',
      })

      // 检查 tool_calls
      expect(result[0].tool_calls).toHaveLength(2)

      // 第一个工具调用
      expect(result[0].tool_calls[0]).toEqual({
        id: 'tool_1',
        type: 'function',
        function: {
          name: 'weather-server___get_weather',
          arguments: JSON.stringify({ city: '北京', unit: 'celsius' }),
        },
      })

      // 第二个工具调用
      expect(result[0].tool_calls[1]).toEqual({
        id: 'tool_2',
        type: 'function',
        function: {
          name: 'news-server___get_latest_news',
          arguments: JSON.stringify({ category: 'tech' }),
        },
      })

      // 检查第二个消息（工具执行结果）
      expect(result[1].role).toBe('tool')
      expect(result[1].tool_call_id).toBe('tool_1')
      // expect(Array.isArray(result[1].content)).toBe(true)
      // expect(result[1].content).toHaveLength(1)
      expect(result[1].content).toBe(JSON.stringify({ success: true, data: '北京今天晴天，温度25°C' }))
    })

    it('助手消息包含未执行的 MCP 工具调用时不生成 tool 消息', () => {
      const messages: IMessage[] = [
        {
          ...baseMsg,
          role: 'assistant',
          content: [{ type: 'text', text: '我正在调用工具...' }],
          mcpTool: [
            {
              id: 'tool_1',
              serverName: 'test-server',
              toolName: 'test_tool',
              args: { param: 'value' },
              executeState: 'await', // 未执行完成
            },
          ],
        },
      ]

      const result = (service as any).transformMessages(messages)

      expect(result).toHaveLength(1) // 只有assistant消息，没有tool消息

      // 检查助手消息
      expect(result[0].role).toBe('assistant')
      expect(result[0].tool_calls).toHaveLength(1)
      expect(result[0].tool_calls[0]).toEqual({
        id: 'tool_1',
        type: 'function',
        function: {
          name: 'test-server___test_tool',
          arguments: JSON.stringify({ param: 'value' }),
        },
      })
    })

    it('混合消息序列能被正确转换', () => {
      const messages: IMessage[] = [
        {
          ...baseMsg,
          id: 'msg1',
          role: 'user',
          content: [{ type: 'text', text: '请帮我查询北京的天气' }],
        },
        {
          ...baseMsg,
          id: 'msg2',
          role: 'assistant',
          content: [{ type: 'text', text: '好的，我来为您查询北京的天气。' }],
          mcpTool: [
            {
              id: 'weather_tool',
              serverName: 'weather-server',
              toolName: 'get_weather',
              args: { city: '北京' },
              executeState: 'completed',
              result: { success: true, data: '晴天，温度25°C' },
            },
          ],
        },
        {
          ...baseMsg,
          id: 'msg3',
          role: 'user',
          content: [{ type: 'text', text: '谢谢！还有什么相关信息吗？' }],
        },
      ]

      const result = (service as any).transformMessages(messages)

      expect(result).toHaveLength(4) // user + assistant + tool_result + user

      // 检查第一条用户消息
      expect(result[0].role).toBe('user')
      expect(result[0].content[0]).toEqual({
        type: 'text',
        text: '请帮我查询北京的天气',
      })

      // 检查助手消息
      expect(result[1].role).toBe('assistant')
      expect(result[1].content[0]).toEqual({
        type: 'text',
        text: '好的，我来为您查询北京的天气。',
      })
      expect(result[1].tool_calls).toHaveLength(1)

      // 检查工具执行结果
      expect(result[2].role).toBe('tool')
      expect(result[2].tool_call_id).toBe('weather_tool')
      expect(result[2].content).toBe(JSON.stringify({ success: true, data: '晴天，温度25°C' }))

      // 检查第二条用户消息
      expect(result[3].role).toBe('user')
      expect(result[3].content[0]).toEqual({
        type: 'text',
        text: '谢谢！还有什么相关信息吗？',
      })
    })

    it('空消息数组能被正确处理', () => {
      const messages: IMessage[] = []

      const result = (service as any).transformMessages(messages)

      expect(result).toHaveLength(0)
    })

    it('消息包含错误内容时能被正确处理', () => {
      const messages: IMessage[] = [
        {
          ...baseMsg,
          role: 'user',
          content: [
            { type: 'error', error: '图片加载失败' },
            { type: 'text', text: '请重试' },
          ],
        },
      ]

      const result = (service as any).transformMessages(messages)

      expect(result).toHaveLength(1)
      expect(result[0].role).toBe('user')
      expect(result[0].content).toHaveLength(1) // 只有text内容被处理
      expect(result[0].content[0]).toEqual({
        type: 'text',
        text: '请重试',
      })
    })
  })
})
