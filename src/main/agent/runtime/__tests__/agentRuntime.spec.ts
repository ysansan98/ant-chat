import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentRuntime } from '../agentRuntime'
import { taskStore } from '../taskStore'

const reportTaskProgressMock = vi.fn()
let callRound = 0
let firstToolName = 'list_dir'
let firstToolArgs: Record<string, unknown> = { path: '.' }

vi.mock('@main/db/services', () => ({
  getMessagesByConvId: vi.fn(async () => []),
  getModelById: vi.fn(async () => ({ id: 'model-1', model: 'test-model', name: 'Test Model', serviceProviderId: 'sp-1' })),
  getProviderServiceById: vi.fn(() => ({ id: 'sp-1', name: 'Test Provider' })),
  createAIMessage: vi.fn(),
  updateMessage: vi.fn(),
}))

vi.mock('@main/ai-providers/factory', () => ({
  createProvider: vi.fn(async () => ({
    async* sendChatCompletions() {
      callRound += 1
      if (callRound === 1) {
        yield {
          content: [],
          functionCalls: [{
            id: 'call-1',
            serverName: 'native',
            toolName: firstToolName,
            args: firstToolArgs,
            executeState: 'await',
          }],
        }
        return
      }
      yield {
        content: [{ type: 'text', text: '已完成' }],
      }
    },
  })),
}))

vi.mock('../agentMessageWriter', () => ({
  createTaskAssistantMessage: vi.fn(async () => ({ id: 'ai-msg-1' })),
  updateTaskAssistantMessage: vi.fn(async () => ({ id: 'ai-msg-1' })),
  finalizeTaskAssistantMessage: vi.fn(async () => ({ id: 'ai-msg-1' })),
}))

vi.mock('../progressReporter', () => ({
  reportTaskState: vi.fn(),
  reportTaskProgress: (...args: unknown[]) => reportTaskProgressMock(...args),
  reportApprovalRequired: vi.fn(),
}))

vi.mock('../checkpointStore', () => ({
  writeCheckpoint: vi.fn(async () => '/tmp/checkpoint.json'),
  removeCheckpoint: vi.fn(async () => {}),
}))

vi.mock('../agentLogger', () => ({
  appendAgentLog: vi.fn(async () => '/tmp/log.jsonl'),
}))

describe('agentRuntime', () => {
  beforeEach(() => {
    ;(taskStore as any).tasks?.clear?.()
    ;(taskStore as any).activeByConversation?.clear?.()
    reportTaskProgressMock.mockClear()
    callRound = 0
    firstToolName = 'list_dir'
    firstToolArgs = { path: '.' }
  })

  it('startTask 创建 task', async () => {
    const res = await agentRuntime.startTask({
      conversationId: 'c1',
      userMessageId: 'm1',
      prompt: '检查当前项目结构',
      mode: 'hybrid',
    })
    expect(res.taskId).toBeTruthy()
  })

  it('同会话并发保护', async () => {
    await agentRuntime.startTask({ conversationId: 'c2', userMessageId: 'm1', prompt: '检查当前项目结构' })
    await expect(agentRuntime.startTask({ conversationId: 'c2', userMessageId: 'm2', prompt: '检查当前项目结构' })).rejects.toThrow('AGENT_TASK_ALREADY_RUNNING')
  })

  it('参数校验', async () => {
    await expect(agentRuntime.startTask({ conversationId: '', userMessageId: '', prompt: '' })).rejects.toThrow('invalid start task options')
  })

  it('“有哪些文件”会触发工具进度', async () => {
    await agentRuntime.startTask({
      conversationId: 'c3',
      userMessageId: 'm3',
      prompt: '你能看下目前工作区有哪些文件吗？',
      mode: 'hybrid',
      chatSettings: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0,
        maxTokens: 256,
        features: { enableMCP: false, onlineSearch: false },
      },
    })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(reportTaskProgressMock).toHaveBeenCalled()
  })

  it('取消等待审批的任务会释放会话', async () => {
    firstToolName = 'write_file'
    firstToolArgs = { path: 'agent-runtime-test.txt', content: 'test' }

    const res = await agentRuntime.startTask({
      conversationId: 'c5',
      userMessageId: 'm5',
      prompt: '写入测试文件',
      mode: 'strict',
      chatSettings: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0,
        maxTokens: 256,
        features: { enableMCP: false, onlineSearch: false },
      },
    })

    await waitForTaskStatus(res.taskId, 'awaiting_approval')
    await agentRuntime.cancelTask({ taskId: res.taskId })
    await waitForTaskStatus(res.taskId, 'cancelled')
    expect(agentRuntime.listActiveTasks('c5')).toEqual([])
  })
})

async function waitForTaskStatus(taskId: string, status: string) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 1000) {
    if (agentRuntime.getTask(taskId).status === status) {
      return
    }
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  expect(agentRuntime.getTask(taskId).status).toBe(status)
}
