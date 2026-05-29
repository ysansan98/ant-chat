import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startAgentTurn } from '../agentTurnService'

const mocks = vi.hoisted(() => ({
  startTurn: vi.fn(),
}))

vi.mock('../agentRuntimeEnvironment', () => ({
  getAgentRuntimeEnvironment: () => ({
    agentService: {
      startTurn: mocks.startTurn,
    },
    runtime: {},
  }),
}))

describe('agentTurnService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startTurn.mockResolvedValue({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
      conversation: { id: 'c1' },
    })
  })

  it('delegates a new turn to AgentRuntime with resolved workspace path', async () => {
    const result = await startAgentTurn({
      prompt: '  inspect project  ',
      modelConfig: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
        features: {
          enableMCP: false,
        },
      },
    })

    expect(mocks.startTurn).toHaveBeenCalledWith({
      prompt: '  inspect project  ',
      modelConfig: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
        features: {
          enableMCP: false,
        },
      },
    })
    expect(result).toEqual(expect.objectContaining({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
    }))
  })

  it('passes existing conversation and turn context fields through', async () => {
    await startAgentTurn({
      conversationId: 'c1',
      prompt: 'run it',
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      referencedFiles: ['src/main.ts'],
      selectedSkill: 'review',
      images: [{ uid: 'img-1', name: 'a.png', size: 1, type: 'image/png', data: 'base64' }],
      attachments: [{ uid: 'file-1', name: 'a.txt', size: 1, type: 'text/plain', data: 'text' }],
      modelConfig: {
        modelId: 'model-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: {
          enableMCP: false,
        },
      },
    })

    expect(mocks.startTurn).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      referencedFiles: ['src/main.ts'],
      selectedSkill: 'review',
    }))
  })
})
