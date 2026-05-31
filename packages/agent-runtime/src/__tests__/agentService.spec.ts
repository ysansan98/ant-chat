import type { AgentRuntime } from '@ant-chat/agent-core'
import type { AppDataContext } from '@ant-chat/app-data'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentRuntimeController } from '../agentRuntimeController'

const startTask = vi.fn()

const runtime = {
  startTask,
  approvePendingAction: vi.fn(),
  rejectPendingAction: vi.fn(),
  cancelTask: vi.fn(),
  injectSteering: vi.fn(),
  listActiveTasks: vi.fn(() => []),
  getTask: vi.fn(),
} as unknown as AgentRuntime

const appDataContext = {
  workspaceService: {
    getCurrentWorkspacePath: vi.fn(() => '/workspace'),
  },
  toolApprovalWhitelistRepository: {
    add: vi.fn(),
  },
} as unknown as AppDataContext

describe('createAgentRuntimeController', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startTask.mockResolvedValue({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
      conversation: { id: 'c1' },
    })
  })

  it('maps app turn options to runtime start options', async () => {
    const service = createAgentRuntimeController(runtime, appDataContext)

    await service.startTurn({
      prompt: 'inspect project',
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

    expect(startTask).toHaveBeenCalledWith({
      prompt: 'inspect project',
      modelId: 'model-1',
      workspacePath: '/workspace',
      mode: 'hybrid',
      chatSettings: {
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
      },
    })
  })

  it('preserves explicit turn context fields', async () => {
    const service = createAgentRuntimeController(runtime, appDataContext)

    await service.startTurn({
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

    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      conversationId: 'c1',
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      referencedFiles: ['src/main.ts'],
      selectedSkill: 'review',
      images: [{ uid: 'img-1', name: 'a.png', size: 1, type: 'image/png', data: 'base64' }],
      attachments: [{ uid: 'file-1', name: 'a.txt', size: 1, type: 'text/plain', data: 'text' }],
    }))
  })
})
