import type { IAIStreamChunk } from '@ant-chat/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CodexCredentials } from '../auth'
import { CODEX_AUTH_ISSUER, CodexAuthSession } from '../auth'
import { CodexAIProvider } from '../ai-provider'
import { CodexBackendClient } from '../backend-client'

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

function createProvider(
  fetchImpl: typeof fetch,
  credentials: CodexCredentials = { accessToken: 'access-token', accountId: 'account-1' },
  now = Date.now,
) {
  const store = createCredentialStore(credentials)
  const client = new CodexBackendClient({
    authSession: new CodexAuthSession('codex-1', store, fetchImpl, now),
    fetchImpl,
  })
  return { provider: new CodexAIProvider(client), store }
}

function sse(...events: unknown[]): Response {
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), {
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function completed(options: {
  inputTokens?: number
  outputTokens?: number
  cachedTokens?: number
  reasoningTokens?: number
} = {}) {
  return {
    type: 'response.completed',
    response: {
      incomplete_details: null,
      usage: {
        input_tokens: options.inputTokens ?? 10,
        input_tokens_details: { cached_tokens: options.cachedTokens ?? 2 },
        output_tokens: options.outputTokens ?? 4,
        output_tokens_details: { reasoning_tokens: options.reasoningTokens ?? 1 },
      },
      service_tier: null,
    },
  }
}

async function collect(provider: CodexAIProvider, overrides: Partial<Parameters<CodexAIProvider['streamModel']>[0]> = {}) {
  const chunks: IAIStreamChunk[] = []
  for await (const chunk of provider.streamModel({
    messages: [{ role: 'user', content: [{ type: 'text', text: '读取文件' }] }],
    modelSettings: {
      model: 'gpt-5.6-luna',
      systemPrompt: '你是助手',
    },
    ...overrides,
  })) {
    chunks.push(chunk)
  }
  return chunks
}

describe('codexAIProvider 行为', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('通过真实 AI SDK 映射文本、推理和 usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-1', phase: 'final_answer' } },
      { type: 'response.output_text.delta', item_id: 'message-1', delta: '你好' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'message-1', phase: 'final_answer' } },
      { type: 'response.output_item.added', output_index: 1, item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: null } },
      { type: 'response.reasoning_summary_text.delta', item_id: 'reasoning-1', summary_index: 0, delta: '思考' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'reasoning', id: 'reasoning-1', encrypted_content: null } },
      completed(),
    ))
    const { provider } = createProvider(fetchImpl)

    await expect(collect(provider)).resolves.toEqual([
      { content: [{ type: 'text', text: '你好' }] },
      { content: [], reasoningContent: '思考' },
      {
        content: [],
        finishReason: 'stop',
        usage: {
          inputTokens: 10,
          outputTokens: 4,
          totalTokens: 14,
          cachedInputTokens: 2,
          reasoningTokens: 1,
        },
      },
    ])
  })

  it('保留 function call 的 call_id 和参数', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read_file', arguments: '', namespace: null },
      },
      { type: 'response.function_call_arguments.delta', item_id: 'item-1', output_index: 0, delta: '{"path":"a.txt"}' },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'function_call', id: 'item-1', call_id: 'call-1', name: 'read_file', arguments: '{"path":"a.txt"}', status: 'completed', namespace: null },
      },
      completed(),
    ))
    const { provider } = createProvider(fetchImpl)

    const chunks = await collect(provider, {
      tools: [{
        name: 'read_file',
        source: 'native',
        serverName: 'filesystem',
        inputSchema: {
          type: 'object',
          properties: { path: { type: 'string' } },
          required: ['path'],
        },
      }],
    })

    expect(chunks).toContainEqual({
      content: [],
      functionCalls: [{
        id: 'call-1',
        serverName: 'filesystem',
        toolName: 'read_file',
        args: { path: 'a.txt' },
        executeState: 'await',
      }],
    })
    expect(chunks.at(-1)?.finishReason).toBe('tool-calls')
  })

  it('忽略 maxOutputTokens 和 temperature，但保留 Codex 支持的请求参数', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(completed()))
    const { provider } = createProvider(fetchImpl)

    await collect(provider, {
      modelSettings: {
        model: 'gpt-5.6-luna',
        systemPrompt: '你是助手',
        maxOutputTokens: 128,
        temperature: 0.8,
        reasoningEffort: 'high',
      },
    })

    const [url, init] = fetchImpl.mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(body).toMatchObject({
      model: 'gpt-5.6-luna',
      input: [
        { role: 'developer', content: '你是助手' },
        { role: 'user', content: [{ type: 'input_text', text: '读取文件' }] },
      ],
      reasoning: { effort: 'high' },
      store: false,
      stream: true,
    })
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(body).not.toHaveProperty('temperature')
  })

  it('非法工具参数保留原文，交给 Runtime 产出参数错误', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(
      {
        type: 'response.output_item.added',
        output_index: 0,
        item: { type: 'function_call', id: 'item-1', call_id: 'call-bad', name: 'read_file', arguments: '', namespace: null },
      },
      {
        type: 'response.output_item.done',
        output_index: 0,
        item: { type: 'function_call', id: 'item-1', call_id: 'call-bad', name: 'read_file', arguments: '{bad json', status: 'completed', namespace: null },
      },
      completed(),
    ))
    const { provider } = createProvider(fetchImpl)

    const chunks = await collect(provider, {
      tools: [{
        name: 'read_file',
        source: 'native',
        inputSchema: { type: 'object', properties: {}, required: [] },
      }],
    })

    expect(chunks).toContainEqual({
      content: [],
      functionCalls: [{
        id: 'call-bad',
        serverName: 'native',
        toolName: 'read_file',
        args: '{bad json',
        executeState: 'await',
      }],
    })
  })

  it('流在 response.completed 前 EOF 时拒绝半截结果', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-1', phase: 'final_answer' } },
      { type: 'response.output_text.delta', item_id: 'message-1', delta: '半截' },
    ))
    const { provider } = createProvider(fetchImpl)

    await expect(collect(provider)).rejects.toThrow('Codex Responses 流在合法终态前结束')
  })

  it('response.incomplete 时保留未完成原因', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse({
      type: 'response.incomplete',
      response: {
        incomplete_details: { reason: 'max_output_tokens' },
        usage: {
          input_tokens: 10,
          input_tokens_details: null,
          output_tokens: 4,
          output_tokens_details: null,
        },
        service_tier: null,
      },
    }))
    const { provider } = createProvider(fetchImpl)

    await expect(collect(provider)).rejects.toThrow('Codex Responses 生成未完成：max_output_tokens')
  })

  it('文件附件在网络请求前被拒绝', async () => {
    const fetchImpl = vi.fn<typeof fetch>()
    const { provider } = createProvider(fetchImpl)

    await expect(collect(provider, {
      messages: [{ role: 'user', content: [{ type: 'file', mimeType: 'application/pdf', data: 'cGRm' }] }],
    })).rejects.toThrow('Codex 订阅暂不支持文件附件（application/pdf）')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('401 时刷新凭据并且只重试一次', async () => {
    const now = 1_000_000
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'new-access-token', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(sse(completed()))
    const { provider, store } = createProvider(fetchImpl, {
      accessToken: 'old-access-token',
      refreshToken: 'refresh-token',
      expiresAt: now + 3_600_000,
    }, () => now)

    await collect(provider)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    expect(fetchImpl.mock.calls[1][0]).toBe(`${CODEX_AUTH_ISSUER}/oauth/token`)
    expect(new Headers(fetchImpl.mock.calls[2][1]?.headers).get('Authorization')).toBe('Bearer new-access-token')
    expect(store.value?.accessToken).toBe('new-access-token')
  })

  it('complete 汇总 AI SDK 文本流与 usage', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(sse(
      { type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'message-1', phase: 'final_answer' } },
      { type: 'response.output_text.delta', item_id: 'message-1', delta: '摘要' },
      { type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: 'message-1', phase: 'final_answer' } },
      completed({ inputTokens: 20, outputTokens: 3 }),
    ))
    const { provider } = createProvider(fetchImpl)

    await expect(provider.complete({
      messages: [{ role: 'system', content: '忽略' }, { role: 'user', content: '请总结' }],
      modelSettings: { model: 'gpt-5.6-luna', systemPrompt: '系统' },
    })).resolves.toEqual({
      text: '摘要',
      usage: {
        inputTokens: 20,
        outputTokens: 3,
        totalTokens: 23,
        cachedInputTokens: 2,
        reasoningTokens: 1,
      },
    })
  })
})
