import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startAgentTurn } from '../agentTurnService'

const mocks = vi.hoisted(() => ({
  startTask: vi.fn(),
  workspaceService: {
    getCurrentWorkspacePath: vi.fn(() => '/workspace'),
  },
}))

vi.mock('@main/adapters/appDataContainer', () => ({
  getAppDataServices: () => ({
    workspaceService: mocks.workspaceService,
  }),
}))

vi.mock('../desktopAgentRuntime', () => ({
  createDesktopAgentRuntime: () => ({
    startTask: mocks.startTask,
  }),
}))

describe('agentTurnService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startTask.mockResolvedValue({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
      conversation: { id: 'c1' },
    })
  })

  it('delegates a new turn to AgentRuntime with resolved workspace path', async () => {
    const result = await startAgentTurn({
      prompt: '  inspect project  ',
      chatSettings: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
        features: {
          onlineSearch: false,
          enableMCP: false,
        },
      },
    })

    expect(mocks.startTask).toHaveBeenCalledWith({
      prompt: '  inspect project  ',
      modelId: 'model-1',
      workspacePath: '/workspace',
      mode: 'hybrid',
      chatSettings: {
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
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
      chatSettings: {
        modelId: 'model-1',
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
        features: {
          onlineSearch: false,
          enableMCP: false,
        },
      },
    })

    expect(mocks.startTask).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      referencedFiles: ['src/main.ts'],
      selectedSkill: 'review',
      chatSettings: {
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
      },
    }))
  })
})
