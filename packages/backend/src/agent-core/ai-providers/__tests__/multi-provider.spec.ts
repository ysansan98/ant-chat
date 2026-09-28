import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentError } from '../../AgentError'
import { MultiProvider } from '../multi-provider'

const mocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(),
}))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogle: vi.fn(),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}))

vi.mock('ai', () => ({
  dynamicTool: vi.fn(),
  generateText: mocks.generateText,
  jsonSchema: vi.fn(schema => schema),
  streamText: mocks.streamText,
}))

describe('multiProvider 行为', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createOpenAI.mockReturnValue({
      chat: vi.fn(model => ({ model })),
    })
  })

  it('模型流中止时抛出 AGENT_CANCELLED', async () => {
    async function* streamGen() {
      yield { type: 'abort', reason: 'user requested cancellation' }
    }

    mocks.streamText.mockReturnValue({
      stream: streamGen(),
    })

    const provider = new MultiProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.test',
      format: 'openai',
    })

    let thrown: unknown
    try {
      for await (const _chunk of provider.streamModel({
        messages: [],
        modelSettings: {
          model: 'test-model',
          systemPrompt: '',
        },
      })) {
        // Consume stream.
      }
    }
    catch (error) {
      thrown = error
    }

    expect(thrown).toBeInstanceOf(AgentError)
    expect(thrown).toMatchObject({
      code: 'AGENT_CANCELLED',
      message: '任务已取消',
    })
  })

  it('初始化 provider 时写入注入的运行日志', () => {
    const logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }

    const provider = new MultiProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.test',
      format: 'openai',
      logger,
    })

    expect(provider).toBeInstanceOf(MultiProvider)
    expect(logger.info).toHaveBeenCalledWith('Initialized with openai format for https://example.test')
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Using proxy:'))
  })

  it('非流式 completion 返回规范化 usage', async () => {
    mocks.generateText.mockResolvedValue({
      text: 'summary',
      usage: {
        inputTokens: 9000,
        outputTokens: 300,
        totalTokens: 9300,
        // v7：推理/缓存 token 移入嵌套字段
        outputTokenDetails: { reasoningTokens: 20 },
        inputTokenDetails: { cacheReadTokens: 100 },
      },
    })
    const provider = new MultiProvider({
      apiKey: 'test-key',
      baseUrl: 'https://example.test',
      format: 'openai',
    })

    await expect(provider.complete({
      messages: [{ role: 'user', content: 'compact this' }],
      modelSettings: {
        model: 'test-model',
        systemPrompt: '',
      },
    })).resolves.toEqual({
      text: 'summary',
      usage: {
        inputTokens: 9000,
        outputTokens: 300,
        totalTokens: 9300,
        reasoningTokens: 20,
        cachedInputTokens: 100,
      },
    })
  })
})

describe('opencode 会话请求头', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createOpenAI.mockReturnValue({
      chat: vi.fn(model => ({ model })),
    })
  })

  /** 驱动一次完整的 streamModel 消费。 */
  async function consumeStream(provider: MultiProvider, conversationId: string) {
    for await (const _chunk of provider.streamModel({
      messages: [],
      modelSettings: { model: 'test-model', systemPrompt: '' },
      conversationId,
    })) {
      // 消费流以触发请求构造。
    }
  }

  it('opencode 端点携带 x-opencode-session，并注入覆盖 UA 的 fetch', async () => {
    async function* streamGen() {
      yield { type: 'finish', finishReason: 'stop' }
    }
    mocks.streamText.mockReturnValue({ stream: streamGen() })

    const provider = new MultiProvider({
      apiKey: 'test-key',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      format: 'openai',
    })

    await consumeStream(provider, 'conv-1')

    expect(mocks.streamText.mock.calls[0][0].headers).toEqual({ 'x-opencode-session': 'conv-1' })
    expect(mocks.createOpenAI).toHaveBeenCalledWith(expect.objectContaining({
      baseURL: 'https://opencode.ai/zen/go/v1',
      fetch: expect.any(Function),
    }))
  })

  it('非 OpenCode 端点不携带会话头', async () => {
    async function* streamGen() {
      yield { type: 'finish', finishReason: 'stop' }
    }
    mocks.streamText.mockReturnValue({ stream: streamGen() })

    const provider = new MultiProvider({
      apiKey: 'test-key',
      baseUrl: 'https://api.example.test/v1',
      format: 'openai',
    })

    await consumeStream(provider, 'conv-1')

    expect(mocks.streamText.mock.calls[0][0].headers).toBeUndefined()
  })

  it('complete 在 OpenCode 端点透传 conversationId', async () => {
    mocks.generateText.mockResolvedValue({ text: 'ok', usage: undefined })

    const provider = new MultiProvider({
      apiKey: 'test-key',
      baseUrl: 'https://opencode.ai/zen/go/v1',
      format: 'openai',
    })

    await provider.complete({
      messages: [{ role: 'user', content: 'hi' }],
      modelSettings: { model: 'test-model', systemPrompt: '' },
      conversationId: 'conv-9',
    })

    expect(mocks.generateText.mock.calls[0][0].headers).toEqual({ 'x-opencode-session': 'conv-9' })
  })
})
