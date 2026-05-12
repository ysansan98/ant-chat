import { beforeEach, describe, expect, it, vi } from 'vitest'

import { agentRuntime } from '../agentRuntime'
import { taskStore } from '../taskStore'

const writerMocks = vi.hoisted(() => ({
  updateTaskAssistantMessage: vi.fn(async () => ({ id: 'ai-msg-1' })),
}))
const loggerMocks = vi.hoisted(() => ({
  appendAgentLog: vi.fn(async () => '/tmp/log.jsonl'),
}))
let callRound = 0
let firstToolName = 'list_dir'
let firstToolArgs: unknown = { path: '.' }
let streamTextChunks = ['已完成']
let toolCallsByRound: Array<{ toolName: string, args: unknown } | null> | null = null

vi.mock('@main/db/services', () => ({
  addMessage: vi.fn(),
  getConversationById: vi.fn(async () => ({ id: 'c1', settings: {} })),
  getMessagesByConvId: vi.fn(async () => []),
  getModelById: vi.fn(async () => ({ id: 'model-1', model: 'test-model', name: 'Test Model', serviceProviderId: 'sp-1' })),
  getProviderServiceById: vi.fn(() => ({ id: 'sp-1', name: 'Test Provider' })),
  createAIMessage: vi.fn(),
  updateConversation: vi.fn(),
  updateMessage: vi.fn(),
}))

vi.mock('@main/ai-providers/factory', () => ({
  createProvider: vi.fn(async () => ({
    async* streamModel() {
      callRound += 1
      const configuredToolCall = toolCallsByRound
        ? toolCallsByRound[callRound - 1]
        : callRound === 1
          ? { toolName: firstToolName, args: firstToolArgs }
          : null
      if (configuredToolCall) {
        yield {
          content: [],
          functionCalls: [{
            id: 'call-1',
            serverName: 'native',
            toolName: configuredToolCall.toolName,
            args: configuredToolCall.args,
            executeState: 'await',
          }],
        }
        return
      }
      for (const text of streamTextChunks) {
        yield {
          content: [{ type: 'text', text }],
        }
      }
    },
  })),
}))

vi.mock('../agentMessageWriter', () => ({
  createTaskAssistantMessage: vi.fn(async () => ({ id: 'ai-msg-1' })),
  updateTaskAssistantMessage: writerMocks.updateTaskAssistantMessage,
  finalizeTaskAssistantMessage: vi.fn(async () => ({ id: 'ai-msg-1' })),
}))

vi.mock('../progressReporter', () => ({
  reportTaskState: vi.fn(),
  reportApprovalRequired: vi.fn(),
}))

vi.mock('../checkpointStore', () => ({
  writeCheckpoint: vi.fn(async () => '/tmp/checkpoint.json'),
  removeCheckpoint: vi.fn(async () => {}),
}))

vi.mock('../agentLogger', () => ({
  appendAgentLog: loggerMocks.appendAgentLog,
}))

describe('agentRuntime', () => {
  beforeEach(() => {
    ;(taskStore as any).tasks?.clear?.()
    ;(taskStore as any).activeByConversation?.clear?.()
    callRound = 0
    firstToolName = 'list_dir'
    firstToolArgs = { path: '.' }
    streamTextChunks = ['已完成']
    toolCallsByRound = null
    writerMocks.updateTaskAssistantMessage.mockClear()
    loggerMocks.appendAgentLog.mockClear()
  })

  it('startTask 创建 task', async () => {
    const res = await agentRuntime.startTask({
      conversationId: 'c1',
      userMessageId: 'm1',
      prompt: '检查当前项目结构',
      executionMode: 'hybrid',
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

  it('模型文本流式写入 assistant message', async () => {
    streamTextChunks = ['Hel', 'lo']
    callRound = 1

    const res = await agentRuntime.startTask({
      conversationId: 'c4',
      userMessageId: 'm4',
      prompt: 'say hello',
      executionMode: 'hybrid',
      modelConfig: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0,
        maxTokens: 256,
        features: { enableMCP: false, onlineSearch: false },
      },
    })

    await waitForTaskStatus(res.taskId, 'success')
    const streamedTexts = (writerMocks.updateTaskAssistantMessage.mock.calls as unknown as Array<[string, { content?: Array<{ text?: string }> }]>)
      .map(call => call[1]?.content?.[0]?.text)
      .filter(Boolean)

    expect(streamedTexts).toContain('Hel')
    expect(streamedTexts).toContain('Hello')
  })

  it('工具参数解析失败时返回错误观察并继续下一轮', async () => {
    toolCallsByRound = [
      { toolName: 'list_dir', args: '{invalid json' },
      { toolName: 'list_dir', args: { path: '.' } },
      null,
    ]
    streamTextChunks = ['修正后完成']

    const res = await agentRuntime.startTask({
      conversationId: 'c6',
      userMessageId: 'm6',
      prompt: '检查当前项目结构',
      executionMode: 'hybrid',
      modelConfig: {
        modelId: 'model-1',
        systemPrompt: '',
        temperature: 0,
        maxTokens: 256,
        features: { enableMCP: false, onlineSearch: false },
      },
    })

    await waitForTaskStatus(res.taskId, 'success')
    const failedToolCalls = (writerMocks.updateTaskAssistantMessage.mock.calls as unknown as Array<[string, { toolCalls?: Array<{ result?: { error?: string } }> }]>)
      .flatMap(call => call[1]?.toolCalls || [])
      .filter(tool => tool.result?.error?.includes('参数解析失败'))

    expect(callRound).toBe(3)
    expect(failedToolCalls).toHaveLength(1)
  })

  it('取消等待审批的任务会释放会话', async () => {
    firstToolName = 'write_file'
    firstToolArgs = { path: 'agent-runtime-test.txt', content: 'test' }

    const res = await agentRuntime.startTask({
      conversationId: 'c5',
      userMessageId: 'm5',
      prompt: '写入测试文件',
      executionMode: 'strict',
      modelConfig: {
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
