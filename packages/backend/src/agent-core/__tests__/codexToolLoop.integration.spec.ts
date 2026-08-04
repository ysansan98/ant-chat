import type { AgentTool, IAgentEventEmitter, ILogger } from '@ant-chat/shared'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexCredentials } from '../ai-providers/codex-auth'
import { CodexAuthSession } from '../ai-providers/codex-auth'
import { CodexAIProvider } from '../ai-providers/codex-ai-provider'
import { CodexBackendClient } from '../ai-providers/codex-backend-client'
import { AgentRuntime } from '../AgentRuntime'
import { ToolRegistry } from '../tools/toolRegistry'

function createCredentialStore(initial?: CodexCredentials) {
  let value = initial ?? null
  return {
    load: vi.fn(async () => value),
    save: vi.fn(async (_providerId: string, next: CodexCredentials) => {
      value = next
    }),
    clear: vi.fn(async () => {
      value = null
    }),
    get value() {
      return value
    },
  }
}

function createMockEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnToolResults: vi.fn(),
    emitTurnFinished: vi.fn(),
  }
}

function createMockLogger(): ILogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}

function createListDirTool(): AgentTool {
  return {
    name: 'list_dir',
    source: 'native',
    description: 'Lists directory contents',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory path' } },
      required: ['path'],
    },
    operationType: 'read',
    inferScope: () => 'workspace',
    execute: async () => {
      return { ok: true, result: 'README.md\nsrc/', diagnostics: { exitCode: 0 } }
    },
  }
}

function sse(...events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function completed() {
  return {
    type: 'response.completed',
    response: {
      incomplete_details: null,
      usage: {
        input_tokens: 10,
        input_tokens_details: null,
        output_tokens: 2,
        output_tokens_details: null,
      },
      service_tier: null,
    },
  }
}

function functionCall(argumentsText: string, callId: string) {
  return [
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { type: 'function_call', id: 'item-1', call_id: callId, name: 'list_dir', arguments: '', namespace: null },
    },
    {
      type: 'response.output_item.done',
      output_index: 0,
      item: {
        type: 'function_call',
        id: 'item-1',
        call_id: callId,
        name: 'list_dir',
        arguments: argumentsText,
        status: 'completed',
        namespace: null,
      },
    },
    completed(),
  ]
}

describe('codex 完整工具循环保持协议 call_id', () => {
  let workspacePath: string

  beforeEach(async () => {
    workspacePath = await mkdtemp(path.join(tmpdir(), 'ant-chat-codex-loop-'))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await rm(workspacePath, { recursive: true, force: true })
  })

  it('第一轮 function_call 的原始 call_id 在第二轮回传时保持不变', { timeout: 15000 }, async () => {
    const store = createCredentialStore({ accessToken: 'access-token' })
    // 第一轮返回带 function_call 的响应；第二轮（带回传）直接完成。
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(sse(...functionCall('{"path":"."}', 'call-abc')))
      .mockResolvedValueOnce(sse(completed()))
    const aiProvider = new CodexAIProvider(new CodexBackendClient({
      authSession: new CodexAuthSession('codex-1', store, fetchImpl),
      fetchImpl,
    }))

    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const runtime = new AgentRuntime({ eventEmitter: emitter, logger })

    await runtime.startPreparedTask({
      conversationId: 'conv-codex-loop',
      userMessageId: 'msg-codex-loop',
      workspacePath,
      mode: 'hybrid',
      userText: '读取目录',
      messages: [
        { role: 'user', content: [{ type: 'text', text: '读取目录' }] },
      ],
      registry: new ToolRegistry([createListDirTool()]),
      systemPrompt: '',
      aiProvider,
      modelName: 'gpt-5-codex',
      providerName: 'codex',
      providerId: 'codex',
      apiMode: 'openai',
    })

    await vi.waitFor(() => expect(emitter.emitTurnFinished).toHaveBeenCalled(), { timeout: 10000 })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    // 第二轮请求体的 function_call 与 function_call_output 必须复用第一轮服务端原始 call_id。
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))
    expect(secondBody.input).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'function_call', call_id: 'call-abc', name: 'list_dir' }),
      expect.objectContaining({ type: 'function_call_output', call_id: 'call-abc' }),
    ]))
  })

  it('非法工具参数不会执行工具，错误通过 invalidArgsError 反馈给模型', { timeout: 15000 }, async () => {
    const store = createCredentialStore({ accessToken: 'access-token' })
    // 第一轮返回参数非法的 function_call；第二轮模型收到参数错误反馈后直接给出最终回复。
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(sse(...functionCall('{bad json', 'call-bad')))
      .mockResolvedValueOnce(sse(completed()))
    const aiProvider = new CodexAIProvider(new CodexBackendClient({
      authSession: new CodexAuthSession('codex-1', store, fetchImpl),
      fetchImpl,
    }))

    const listDir = createListDirTool()
    const execute = vi.spyOn(listDir, 'execute')
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const runtime = new AgentRuntime({ eventEmitter: emitter, logger })

    await runtime.startPreparedTask({
      conversationId: 'conv-codex-bad-args',
      userMessageId: 'msg-codex-bad-args',
      workspacePath,
      mode: 'hybrid',
      userText: '读取目录',
      messages: [
        { role: 'user', content: [{ type: 'text', text: '读取目录' }] },
      ],
      registry: new ToolRegistry([listDir]),
      systemPrompt: '',
      aiProvider,
      modelName: 'gpt-5-codex',
      providerName: 'codex',
      providerId: 'codex',
      apiMode: 'openai',
    })

    await vi.waitFor(() => expect(emitter.emitTurnFinished).toHaveBeenCalled(), { timeout: 10000 })

    // 参数非法时工具不得执行。
    expect(execute).not.toHaveBeenCalled()
    // 第二轮把参数错误作为 function_call_output 反馈给模型，让模型自行修正。
    const secondBody = JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))
    const toolOutput = secondBody.input.find((item: { type: string }) => item.type === 'function_call_output')
    expect(toolOutput).toMatchObject({ call_id: 'call-bad' })
    expect(String(toolOutput.output)).toContain('argument error')
  })

  it('codex 生成未完成时 Turn 失败，不持久化半截成功答案', { timeout: 15000 }, async () => {
    const store = createCredentialStore({ accessToken: 'access-token' })
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-1', phase: 'final_answer' } },
      { type: 'response.output_text.delta', item_id: 'message-1', delta: '半截答案' },
      {
        type: 'response.incomplete',
        response: {
          incomplete_details: { reason: 'max_output_tokens', diagnostic: '上游内部诊断不得透传' },
          usage: {
            input_tokens: 10,
            input_tokens_details: null,
            output_tokens: 2,
            output_tokens_details: null,
          },
          service_tier: null,
        },
      },
    ))
    const aiProvider = new CodexAIProvider(new CodexBackendClient({
      authSession: new CodexAuthSession('codex-1', store, fetchImpl),
      fetchImpl,
    }))
    const emitter = createMockEmitter()
    const runtime = new AgentRuntime({ eventEmitter: emitter, logger: createMockLogger() })

    await runtime.startPreparedTask({
      conversationId: 'conv-codex-incomplete',
      userMessageId: 'msg-codex-incomplete',
      workspacePath,
      mode: 'hybrid',
      userText: '请生成完整答案',
      messages: [{ role: 'user', content: [{ type: 'text', text: '请生成完整答案' }] }],
      registry: new ToolRegistry([]),
      systemPrompt: '',
      aiProvider,
      modelName: 'gpt-5-codex',
      providerName: 'codex',
      providerId: 'codex',
      apiMode: 'openai',
    })

    await vi.waitFor(() => {
      expect(emitter.emitTurnFinished).toHaveBeenCalledWith(expect.objectContaining({
        status: 'error',
        text: expect.stringContaining('Codex Responses 生成未完成：max_output_tokens'),
      }))
    }, { timeout: 10000 })
    expect(emitter.emitTurnFinished).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'success' }))
    expect(emitter.emitTurnFinished).not.toHaveBeenCalledWith(expect.objectContaining({
      text: expect.stringContaining('上游内部诊断不得透传'),
    }))
    expect(emitter.emitTaskUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })
})
