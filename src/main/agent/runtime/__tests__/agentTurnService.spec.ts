import { beforeEach, describe, expect, it, vi } from 'vitest'
import { startAgentTurn } from '../agentTurnService'

const mocks = vi.hoisted(() => ({
  addConversation: vi.fn(),
  addMessage: vi.fn(),
  getConversationById: vi.fn(),
  listActiveTasks: vi.fn(),
  startTask: vi.fn(),
}))

vi.mock('@main/db/services', () => ({
  addConversation: mocks.addConversation,
  addMessage: mocks.addMessage,
  getConversationById: mocks.getConversationById,
}))

vi.mock('@main/store/workspace', () => ({
  WorkspaceStore: {
    getInstance: () => ({
      getCurrentWorkspacePath: () => '/workspace',
    }),
  },
}))

vi.mock('@ant-chat/agent-runtime', () => ({
  AgentRuntime: class {
    listActiveTasks = mocks.listActiveTasks
    startTask = mocks.startTask
  },
  buildPromptWithTurnContext: vi.fn((opts: { prompt: string }) => opts.prompt),
}))

describe('agentTurnService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.addConversation.mockResolvedValue({
      id: 'c1',
      title: 'Untitled',
      workspacePath: '/workspace',
      createdAt: 1,
      updatedAt: 1,
      settings: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0.7,
        maxTokens: 1024,
      },
    })
    mocks.addMessage.mockResolvedValue({ id: 'm1', convId: 'c1' })
    mocks.getConversationById.mockResolvedValue({ id: 'c1', title: 'Existing' })
    mocks.listActiveTasks.mockReturnValue([])
    mocks.startTask.mockResolvedValue({ taskId: 't1' })
  })

  it('creates conversation, user message, and agent task for a new turn', async () => {
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

    expect(mocks.addConversation).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Untitled',
      workspacePath: '/workspace',
    }))
    expect(mocks.addMessage).toHaveBeenCalledWith({
      convId: 'c1',
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: 'inspect project' }],
      images: [],
      attachments: [],
    })
    expect(mocks.startTask).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      userMessageId: 'm1',
      prompt: 'inspect project',
      workspacePath: '/workspace',
    }))
    expect(result).toEqual(expect.objectContaining({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
    }))
  })

  it('does not insert a user message when the conversation already has an active task', async () => {
    mocks.listActiveTasks.mockReturnValue([{ taskId: 't-existing' }])

    await expect(startAgentTurn({
      conversationId: 'c1',
      prompt: 'run it',
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
    })).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')

    expect(mocks.addMessage).not.toHaveBeenCalled()
    expect(mocks.startTask).not.toHaveBeenCalled()
  })
})
