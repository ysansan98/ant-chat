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

describe('createAgentRuntimeController 行为', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    startTask.mockResolvedValue({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
      conversation: { id: 'c1' },
    })
  })

  it('将应用层 turn 参数映射为 runtime start 参数', async () => {
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
      modelSettings: {
        systemPrompt: 'custom',
        temperature: 0.2,
        maxTokens: 2048,
      },
    })
  })

  it('保留显式传入的 turn 上下文字段', async () => {
    const service = createAgentRuntimeController(runtime, appDataContext)

    await service.startTurn({
      conversationId: 'c1',
      prompt: 'run it',
      workspacePath: '/explicit-workspace',
      mode: 'strict',
      referencedFiles: ['src/main.ts'],
      selectedSkill: 'review',
      content: [
        { type: 'text', text: 'run it' },
        { type: 'image-block', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', media_type: 'image/png', size: 1 },
        { type: 'document', source: { type: 'file_id', file_id: 'file-1' }, name: 'a.txt', media_type: 'text/plain', size: 1 },
      ],
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
      content: [
        { type: 'text', text: 'run it' },
        { type: 'image-block', source: { type: 'file_id', file_id: 'img-1' }, name: 'a.png', media_type: 'image/png', size: 1 },
        { type: 'document', source: { type: 'file_id', file_id: 'file-1' }, name: 'a.txt', media_type: 'text/plain', size: 1 },
      ],
    }))
  })

  it('记住审批时写入工具白名单后再批准 pending action', () => {
    vi.mocked(runtime.getTask).mockReturnValue({
      taskId: 't1',
      conversationId: 'c1',
      userMessageId: 'm1',
      workspacePath: '/workspace',
      mode: 'strict',
      status: 'awaiting_approval',
      createdAt: 1,
      updatedAt: 1,
      logPath: '',
      prompt: 'inspect',
      pendingAction: {
        actionId: 'a1',
        toolName: 'write_file',
        operationType: 'write',
        scope: 'workspace',
        inputPreview: '{"path":"src/index.ts"}',
        createdAt: 1,
        whitelistPattern: './src/**',
      },
    })

    const service = createAgentRuntimeController(runtime, appDataContext)
    const result = service.approvePendingActionWithWhitelist({
      taskId: 't1',
      actionId: 'a1',
      remember: true,
      workspacePath: '/workspace',
    })

    expect(result).toBeNull()
    expect(appDataContext.toolApprovalWhitelistRepository.add).toHaveBeenCalledWith({
      toolName: 'write_file',
      toolScope: 'workspace',
      pattern: './src/**',
      workspacePath: '/workspace',
    })
    expect(runtime.approvePendingAction).toHaveBeenCalledWith({
      taskId: 't1',
      actionId: 'a1',
      remember: true,
      workspacePath: '/workspace',
    })
  })
})
