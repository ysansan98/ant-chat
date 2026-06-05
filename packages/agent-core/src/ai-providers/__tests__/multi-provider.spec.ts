import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentError } from '../../AgentError'
import { MultiProvider } from '../multi-provider'

const mocks = vi.hoisted(() => ({
  createOpenAI: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(),
}))

vi.mock('@ai-sdk/deepseek', () => ({
  createDeepSeek: vi.fn(),
}))

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(),
}))

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: mocks.createOpenAI,
}))

vi.mock('ai', () => ({
  dynamicTool: vi.fn(),
  generateText: vi.fn(),
  jsonSchema: vi.fn(schema => schema),
  streamText: mocks.streamText,
}))

describe('multiProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createOpenAI.mockReturnValue({
      chat: vi.fn(model => ({ model })),
    })
  })

  it('throws AGENT_CANCELLED when the model stream aborts', async () => {
    async function* fullStream() {
      yield { type: 'abort', reason: 'user requested cancellation' }
    }

    mocks.streamText.mockReturnValue({
      fullStream: fullStream(),
      totalUsage: Promise.resolve({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      }),
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
      message: 'Task cancelled',
    })
  })
})
