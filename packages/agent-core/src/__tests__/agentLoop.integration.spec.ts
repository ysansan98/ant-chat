import type { AgentTool, IAgentEventEmitter, IAIProvider, IAIStreamChunk, ILogger } from '@ant-chat/shared'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { useAimock as setupAimock } from '@copilotkit/aimock/vitest'
import OpenAI from 'openai'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentRuntime } from '../AgentRuntime'
import { ToolRegistry } from '../tools/toolRegistry'

const aimock = setupAimock({ patchEnv: false })

// ============================================================
// Lightweight OpenAI IAIProvider pointing at aimock
// ============================================================
function createAimockAIProvider(baseUrl: string): IAIProvider {
  const client = new OpenAI({ baseURL: `${baseUrl}/v1`, apiKey: 'mock', dangerouslyAllowBrowser: true })

  return {
    async* streamModel(opts) {
      const openaiTools = opts.tools?.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description ?? '',
          parameters: t.inputSchema as Record<string, unknown>,
        },
      }))

      // Use non-streaming call for reliability, wrapped as a single-chunk stream
      const completion = await client.chat.completions.create({
        model: opts.chatSettings.model,
        messages: opts.messages.map((m) => {
          const textParts = m.content.filter(c => c.type === 'text')
          const toolCallParts = m.content.filter(c => c.type === 'tool-call')
          const toolResultParts = m.content.filter(c => c.type === 'tool-result')

          if (m.role === 'tool') {
            return {
              role: 'tool' as const,
              content: toolResultParts.map(p => typeof p.result === 'string' ? p.result : JSON.stringify(p.result)).join('\n'),
              tool_call_id: toolResultParts[0]?.toolCallId ?? '',
            }
          }
          return {
            role: m.role as 'user' | 'assistant',
            content: textParts.map(p => p.text).join('\n') || undefined,
            tool_calls: m.role === 'assistant' && toolCallParts.length > 0
              ? toolCallParts.map(tc => ({
                  id: tc.toolCallId,
                  type: 'function' as const,
                  function: { name: tc.toolName, arguments: JSON.stringify(tc.args) },
                }))
              : undefined,
          }
        }) as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
        tools: openaiTools?.length ? openaiTools : undefined,
        temperature: opts.chatSettings.temperature ?? 0,
        max_tokens: opts.chatSettings.maxTokens ?? 1024,
      })

      const choice = completion.choices?.[0]
      const message = choice?.message

      const text = message?.content ?? ''
      const toolCalls: IAIStreamChunk['functionCalls'] | undefined = message?.tool_calls
        ?.filter((tc): tc is OpenAI.Chat.Completions.ChatCompletionMessageToolCall & { type: 'function' } => tc.type === 'function')
        .map(tc => ({
          toolName: tc.function.name ?? '',
          args: (() => {
            try {
              return JSON.parse(tc.function.arguments ?? '{}')
            }
            catch {
              return {}
            }
          })(),
        }))

      yield {
        content: text ? [{ type: 'text', text }] : undefined,
        functionCalls: toolCalls?.length ? toolCalls : undefined,
      }
    },
    complete: async (opts) => {
      const res = await client.chat.completions.create({
        model: opts.chatSettings.model,
        messages: opts.messages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content })),
      })
      return { text: res.choices?.[0]?.message?.content ?? '' }
    },
  }
}

// ============================================================
// Helpers
// ============================================================
function createMockEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
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
      return { ok: true, output: 'README.md\nsrc/', exitCode: 0 }
    },
  }
}

function getAllMessageText(request: unknown): string {
  const body = request as { messages?: Array<{ role: string, content: string | Array<{ type: string, text?: string, toolName?: string }> }> }
  return (body?.messages ?? [])
    .map((m) => {
      if (typeof m.content === 'string')
        return m.content
      if (Array.isArray(m.content)) {
        return m.content.map(c => c.text ?? (c as Record<string, unknown>).toolName ?? '').join(' ')
      }
      return ''
    })
    .join('\n')
}

describe('agentLoop integration (aimock)', () => {
  let workspacePath: string

  beforeEach(async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    workspacePath = await mkdtemp(path.join(tmpdir(), 'ant-chat-e2e-'))
    await writeFile(path.join(workspacePath, 'README.md'), '# Test Workspace\n\nE2E test target.\n', 'utf8')

    aimock().llm.reset()
    // Second turn: after tool result, return final text.
    aimock().llm.on({
      predicate: request => getAllMessageText(request).includes('README.md'),
    }, {
      content: 'The workspace contains a README.md file. Task complete.',
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    })
    // First turn: with "inspect" prompt, return tool call
    aimock().llm.on({
      predicate: (request) => {
        const text = getAllMessageText(request)
        return text.includes('inspect') && !text.includes('README.md')
      },
    }, {
      toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }],
    })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    if (workspacePath) {
      await rm(workspacePath, { recursive: true, force: true })
    }
  })

  it('runs model → tool → model cycle through AgentRuntime with aimock', { timeout: 15000 }, async () => {
    const emitter = createMockEmitter()
    const logger = createMockLogger()
    const runtime = new AgentRuntime({ eventEmitter: emitter, logger })
    const aiProvider = createAimockAIProvider(aimock().url)

    const { taskId } = await runtime.startTask({
      conversationId: 'conv-e2e-1',
      userMessageId: 'msg-e2e-1',
      workspacePath,
      mode: 'hybrid',
      prompt: 'inspect workspace',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'inspect workspace' }] },
      ],
      systemPrompt: 'You are a helpful coding assistant. Use tools to inspect the workspace.',
      registry: new ToolRegistry([createListDirTool()]),
      aiProvider,
      modelName: 'gpt-4o-mini',
      providerName: 'aimock',
      providerId: 'aimock',
      apiMode: 'openai',
    })

    // Wait for task to complete (poll up to 12 seconds)
    const startedAt = Date.now()
    let finalStatus = ''
    while (Date.now() - startedAt < 12000) {
      try {
        const task = runtime.getTask(taskId)
        finalStatus = task.status
        if (['success', 'failed', 'cancelled'].includes(task.status)) {
          break
        }
      }
      catch {
        // task not found = finished and cleaned up
        finalStatus = 'success'
        break
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    expect(['success', 'cancelled']).toContain(finalStatus)
    expect(emitter.emitTurnFinished).toHaveBeenCalled()
    expect(logger.info).not.toHaveBeenCalled()
  })
})
