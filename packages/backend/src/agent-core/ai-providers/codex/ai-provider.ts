import type { IAIProvider, IAIStreamChunk, LanguageModelUsage, LoopMessage, ReasoningEffortLevel, RuntimeToolDefinition } from '@ant-chat/shared'
import type { LanguageModelUsage as AISdkUsage, ModelMessage } from 'ai'
import type { CodexBackendClient } from './backend-client'
import { createOpenAI } from '@ai-sdk/openai'
import { dynamicTool, jsonSchema, streamText } from 'ai'
import { AgentError } from '../../AgentError'
import { CODEX_DEFAULT_BASE_URL } from './auth'
import { CodexBackendError } from './backend-client'

/**
 * Codex subscription 到 Agent Runtime seam 的 AI SDK adapter。
 *
 * OAuth、固定 credential audience 和 401 refresh 由 CodexBackendClient 拥有；
 * Responses 请求、SSE 解码、工具调用和 usage 归一化由 AI SDK 拥有。
 */
export class CodexAIProvider implements IAIProvider {
  private readonly openai

  constructor(client: CodexBackendClient) {
    this.openai = createOpenAI({
      baseURL: CODEX_DEFAULT_BASE_URL,
      // 真实 Authorization 由 custom fetch 在每次请求时动态覆盖。
      apiKey: 'codex-subscription',
      fetch: client.fetchResponses,
    })
  }

  async* streamModel(options: Parameters<IAIProvider['streamModel']>[0]): AsyncGenerator<IAIStreamChunk> {
    const tools = toAISdkTools(options.tools)
    const result = streamText({
      model: this.openai.responses(options.modelSettings.model),
      instructions: options.modelSettings.systemPrompt || undefined,
      messages: toAISdkMessages(options.messages),
      tools,
      abortSignal: options.abortSignal,
      maxRetries: 0,
      include: { rawChunks: true },
      providerOptions: {
        openai: {
          store: false,
          ...(tools ? { parallelToolCalls: true } : {}),
          ...toReasoningOptions(options.modelSettings.reasoningEffort),
        },
      },
    })

    let observedCompleted = false
    let incompleteReason: string | undefined
    let finishReason: string | undefined
    let rawFinishReason: string | undefined
    const pendingToolItems = new Set<string>()

    try {
      for await (const part of result.stream) {
        switch (part.type) {
          case 'raw': {
            const raw = asRecord(part.rawValue)
            const type = asString(raw?.type)
            const item = asRecord(raw?.item)
            if (type === 'response.output_item.added' && item?.type === 'function_call') {
              pendingToolItems.add(asString(item.id))
            }
            else if (type === 'response.output_item.done' && item?.type === 'function_call') {
              pendingToolItems.delete(asString(item.id))
            }
            else if (type === 'response.completed') {
              observedCompleted = true
            }
            else if (type === 'response.incomplete') {
              const response = asRecord(raw?.response)
              const details = asRecord(response?.incomplete_details)
              incompleteReason = asString(details?.reason) || '未知原因'
            }
            break
          }
          case 'reasoning-delta':
            yield { content: [], reasoningContent: part.text }
            break
          case 'text-delta':
            yield { content: [{ type: 'text', text: part.text }] }
            break
          case 'tool-call': {
            const tool = options.tools?.find(candidate => candidate.name === part.toolName)
            yield {
              content: [],
              functionCalls: [{
                id: part.toolCallId,
                serverName: tool?.serverName || 'native',
                toolName: part.toolName,
                args: part.input as Record<string, unknown> | string,
                executeState: 'await',
              }],
            }
            break
          }
          case 'finish':
            finishReason = part.finishReason
            rawFinishReason = part.rawFinishReason
            break
          case 'error':
            throw normalizeError(part.error)
          case 'abort':
            throw new AgentError('AGENT_CANCELLED', '任务已取消')
        }
      }
    }
    catch (error) {
      throw normalizeError(error)
    }

    if (incompleteReason || finishReason === 'length' || finishReason === 'content-filter') {
      throw new CodexBackendError(200, `Codex Responses 生成未完成：${incompleteReason || rawFinishReason || finishReason}`)
    }
    if (!observedCompleted) {
      throw new CodexBackendError(200, 'Codex Responses 流在合法终态前结束，输出不完整。')
    }
    if (pendingToolItems.size > 0) {
      throw new CodexBackendError(200, 'Codex Responses 工具调用未收到完成 item，输出不完整。')
    }
    if (finishReason !== 'stop' && finishReason !== 'tool-calls') {
      throw new CodexBackendError(200, `Codex Responses 返回了非法终态：${rawFinishReason || finishReason || '缺失'}。`)
    }

    yield {
      content: [],
      usage: normalizeUsage(await result.usage),
      finishReason,
    }
  }

  async complete(options: Parameters<IAIProvider['complete']>[0]): Promise<{ text: string, usage?: LanguageModelUsage }> {
    let text = ''
    let usage: LanguageModelUsage | undefined
    for await (const chunk of this.streamModel({
      messages: options.messages.flatMap((message): LoopMessage[] => message.role === 'system'
        ? []
        : [{
            role: message.role,
            content: [{ type: 'text', text: message.content }],
          }]),
      modelSettings: options.modelSettings,
      abortSignal: options.abortSignal,
    })) {
      text += chunk.content?.map(item => item.text).join('') ?? ''
      usage = chunk.usage ?? usage
    }
    return { text, usage }
  }
}

function toAISdkMessages(messages: LoopMessage[]): ModelMessage[] {
  return messages.map((message): ModelMessage => {
    if (message.role === 'user') {
      const content: Exclude<Extract<ModelMessage, { role: 'user' }>['content'], string> = []
      for (const part of message.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text })
        }
        else if (part.type === 'image') {
          content.push({ type: 'file', data: part.data, mediaType: part.mimeType })
        }
        else if (part.type === 'file') {
          throw new CodexBackendError(400, `Codex 订阅暂不支持文件附件（${part.mimeType}），请粘贴文本或改用图片。`)
        }
      }
      return {
        role: 'user',
        content: content.length === 1 && content[0].type === 'text' ? content[0].text : content,
      }
    }
    if (message.role === 'assistant') {
      const content: Extract<ModelMessage, { role: 'assistant' }>['content'] = []
      for (const part of message.content) {
        if (part.type === 'text') {
          content.push({ type: 'text', text: part.text })
        }
        else if (part.type === 'tool-call') {
          content.push({
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            input: part.args,
          })
        }
      }
      return {
        role: 'assistant',
        content,
      }
    }
    const content: Extract<ModelMessage, { role: 'tool' }>['content'] = []
    for (const part of message.content) {
      if (part.type === 'tool-result') {
        content.push({
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: {
            type: part.isError ? 'error-text' : 'text',
            value: String(part.result ?? ''),
          },
        })
      }
    }
    return {
      role: 'tool',
      content,
    }
  })
}

function toAISdkTools(tools?: RuntimeToolDefinition[]) {
  if (!tools?.length) {
    return undefined
  }
  return Object.fromEntries(tools.map(tool => [tool.name, dynamicTool({
    description: tool.description,
    inputSchema: jsonSchema(tool.inputSchema),
  })]))
}

function toReasoningOptions(reasoningEffort?: ReasoningEffortLevel) {
  return reasoningEffort && reasoningEffort !== 'provider-default'
    ? { reasoningEffort }
    : {}
}

function normalizeUsage(usage: AISdkUsage): LanguageModelUsage {
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
  }
}

function normalizeError(error: unknown): Error {
  let current = error
  while (current instanceof Error) {
    if (current instanceof CodexBackendError || current instanceof AgentError) {
      return current
    }
    current = current.cause
  }
  return error instanceof Error ? error : new Error('Codex Responses 返回失败。')
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
