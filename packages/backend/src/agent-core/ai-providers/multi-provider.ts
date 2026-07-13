import type { AnthropicProvider } from '@ai-sdk/anthropic'
import type { DeepSeekProvider } from '@ai-sdk/deepseek'
import type { GoogleProvider } from '@ai-sdk/google'
import type { OpenAIProvider } from '@ai-sdk/openai'
import type { IAIStreamChunk, ILogger, ProviderConfigSchema, ReasoningEffortLevel } from '@ant-chat/shared'
import type { LanguageModel, LanguageModelUsage, ModelMessage } from 'ai'
import type { ProviderFormat } from './types'
import process from 'node:process'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogle } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { dynamicTool, generateText, jsonSchema, streamText } from 'ai'
import { AgentError } from '../AgentError'

type ProviderLogger = ILogger & {
  debug?: (msg: string, ...args: unknown[]) => void
}

const noopLogger: ProviderLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
}

// 工厂表：取代构造函数里的 switch，所有厂商统一返回 LanguageModel 接口（无 any）
const PROVIDER_FACTORIES = {
  anthropic: createAnthropic,
  deepseek: createDeepSeek,
  google: createGoogle,
  openai: createOpenAI,
} as const

/**
 * 多提供商 AI 提供商
 * 支持 DeepSeek、OpenAI、Gemini、Anthropic 等多种 AI 提供商
 *
 * v7 实现要点：
 * - PROVIDER_FACTORIES 表取代构造函数 switch，消除 any 返回类型；
 * - 系统提示走 streamText/generateText 的 instructions 选项（v7 默认拒绝 messages 里的 system 角色）；
 * - transformToAISdkMessages 返回类型化的 ModelMessage[]，图片统一用 file 部件；
 * - 流消费遍历 result.stream（类型化 TextStreamPart），usage 以 result.usage 为单一来源。
 */
export class MultiProvider {
  private client: DeepSeekProvider | OpenAIProvider | GoogleProvider | AnthropicProvider
  private format: ProviderFormat
  private logger: ProviderLogger

  private normalizeUsage(usage?: LanguageModelUsage) {
    if (!usage) {
      return undefined
    }

    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      // v7：推理/缓存 token 移入嵌套字段
      reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
      cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    }
  }

  private normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }

  constructor(options: {
    baseUrl: string
    apiKey: string
    format?: ProviderFormat
    logger?: ILogger
  }) {
    this.format = options.format || 'openai'
    this.logger = options.logger ?? noopLogger

    this.logger.info(`Initialized with ${this.format} format for ${options.baseUrl}`)
    this.logger.info(`Using proxy: ${process.env.HTTP_PROXY || 'none'}`)

    // 验证必要参数
    if (!options.apiKey || options.apiKey.trim() === '') {
      const errorMsg = `API Key is required for ${this.format} provider. Please check the provider configuration.`
      this.logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    if (!options.baseUrl || options.baseUrl.trim() === '') {
      const errorMsg = `Base URL is required for ${this.format} provider. Please check the provider configuration.`
      this.logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    this.client = PROVIDER_FACTORIES[this.format]({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
    })
  }

  /**
   * 创建模型客户端。OpenAI 走 Chat Completions（.chat），其余走统一的 .languageModel。
   */
  private createModelClient(model: string): LanguageModel {
    if (this.format === 'openai' && 'chat' in this.client) {
      return this.client.chat(model)
    }

    return this.client.languageModel(model)
  }

  /**
   * 将内部消息格式转换为 AI SDK 的 ModelMessage[]。
   * 系统提示不再进 messages（由调用方通过 instructions 传入）；图片统一用 file 部件。
   */
  private transformToAISdkMessages(messages: any[]): ModelMessage[] {
    const aiSdkMessages: ModelMessage[] = []

    for (const message of messages) {
      if (message.role === 'user') {
        const parts: any[] = []
        for (const content of message.content) {
          if (content.type === 'text') {
            parts.push({ type: 'text', text: content.text })
          }
          else if (content.type === 'image') {
            parts.push({ type: 'file', data: content.data, mediaType: content.mimeType })
          }
          else if (content.type === 'file') {
            parts.push({ type: 'file', data: content.data, mediaType: content.mimeType })
          }
        }
        aiSdkMessages.push({
          role: 'user',
          content: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts,
        })
      }
      else if (message.role === 'assistant') {
        const parts: any[] = []
        for (const content of message.content) {
          if (content.type === 'text') {
            parts.push({ type: 'text', text: content.text })
          }
          else if (content.type === 'tool-call') {
            parts.push({
              type: 'tool-call',
              toolCallId: content.toolCallId,
              toolName: content.toolName,
              input: content.args,
            })
          }
          else if (content.type === 'image') {
            parts.push({ type: 'file', data: content.data, mediaType: content.mimeType })
          }
        }
        aiSdkMessages.push({ role: 'assistant', content: parts })
      }
      else if (message.role === 'tool') {
        const parts: any[] = []
        for (const content of message.content) {
          if (content.type === 'tool-result') {
            const outputType = content.isError ? 'error-text' : 'text'
            parts.push({
              type: 'tool-result',
              toolCallId: content.toolCallId,
              toolName: content.toolName,
              output: {
                type: outputType,
                value: String(content.result ?? ''),
              },
            })
          }
        }
        if (parts.length > 0) {
          aiSdkMessages.push({ role: 'tool', content: parts })
        }
      }
    }

    return aiSdkMessages
  }

  /**
   * Stream model output.
   */
  async* streamModel(options: {
    messages: any[]
    modelSettings: {
      model: string
      temperature?: number
      maxOutputTokens?: number
      systemPrompt: string
      reasoningEffort?: ReasoningEffortLevel
    }
    tools?: Array<{
      name: string
      description?: string
      inputSchema: Record<string, unknown>
      serverName?: string
    }>
    abortSignal?: AbortSignal
  }): AsyncGenerator<IAIStreamChunk> {
    const { messages, modelSettings, abortSignal, tools } = options
    const { model, temperature, maxOutputTokens, systemPrompt, reasoningEffort } = modelSettings

    // 构建 AI SDK 格式的消息（系统提示已通过 instructions 传入，不在此构造）
    const aiSdkMessages = this.transformToAISdkMessages(messages)

    const aiTools = tools && tools.length > 0
      ? Object.fromEntries(tools.map(item => [item.name, dynamicTool({
          description: item.description,
          inputSchema: jsonSchema(item.inputSchema),
          execute: async () => {
            throw new Error('RUNTIME_EXTERNAL_TOOL_EXECUTION')
          },
        })]))
      : undefined

    const result = streamText({
      model: this.createModelClient(model),
      // v7：系统提示走 instructions，不再塞进 messages
      instructions: systemPrompt || undefined,
      messages: aiSdkMessages,
      temperature,
      maxOutputTokens,
      // v7：统一推理强度参数；未设置时不传，走厂商默认
      ...(reasoningEffort ? { reasoning: reasoningEffort } : {}),
      tools: aiTools,
      abortSignal,
    })

    let finishReason: string | undefined

    // 遍历 result.stream（v7 对 fullStream 的重命名），类型化为 TextStreamPart
    for await (const part of result.stream) {
      switch (part.type) {
        case 'reasoning-delta':
          yield { content: [], reasoningContent: part.text }
          break
        case 'text-delta':
          yield { content: [{ type: 'text', text: part.text }] }
          break
        case 'tool-call': {
          const toolDef = tools?.find(item => item.name === part.toolName)
          yield {
            content: [],
            functionCalls: [{
              id: part.toolCallId,
              serverName: toolDef?.serverName || 'native',
              toolName: part.toolName,
              args: (part.input ?? {}) as Record<string, unknown>,
              executeState: 'await' as const,
            }],
          }
          break
        }
        case 'finish':
          finishReason = part.finishReason
          break
        case 'error':
          throw this.normalizeError(part.error)
        case 'abort':
          throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
      }
    }

    // 单一 usage 来源，取代 onFinish 回调 + fullStream.finish.totalUsage + result.totalUsage 三处冗余读取
    const usage = await result.usage
    yield {
      content: [],
      usage: this.normalizeUsage(usage),
      finishReason,
    }
  }

  /**
   * 非流式补全，用于摘要生成等场景。
   */
  async complete(options: {
    messages: Array<{ role: 'user' | 'assistant' | 'system', content: string }>
    modelSettings: {
      model: string
      systemPrompt: string
      maxOutputTokens?: number
      reasoningEffort?: ReasoningEffortLevel
    }
    abortSignal?: AbortSignal
  }): Promise<{ text: string, usage?: ReturnType<MultiProvider['normalizeUsage']> }> {
    const { messages, modelSettings, abortSignal } = options
    const { model, systemPrompt, maxOutputTokens, reasoningEffort } = modelSettings

    const aiSdkMessages: ModelMessage[] = messages.map(msg => ({
      // v7 默认拒绝 messages 里的 system 角色；systemPrompt 已通过 instructions 传入，这里兜底转 user
      role: msg.role === 'system' ? 'user' : msg.role,
      content: msg.content,
    }))

    const result = await generateText({
      model: this.createModelClient(model),
      instructions: systemPrompt || undefined,
      messages: aiSdkMessages,
      maxOutputTokens,
      // v7：统一推理强度参数；未设置时不传，走厂商默认
      ...(reasoningEffort ? { reasoning: reasoningEffort } : {}),
      abortSignal,
    })

    return {
      text: result.text,
      usage: this.normalizeUsage(result.usage),
    }
  }

  /**
   * 生成对话标题
   */
  async createConversationTitle(options: {
    context: string
    model: string
  }) {
    const { context, model } = options

    try {
      // v7：直接用 generateText 取 result.text，无需为读文本而走 streamText
      const { text } = await generateText({
        model: this.createModelClient(model),
        prompt: context,
      })

      return text
    }
    catch (error) {
      this.logger.error('Error in createConversationTitle:', error)
      throw error
    }
  }

  /**
   * 验证提供商配置是否正确
   */
  async validateConnection(model: string): Promise<{ success: boolean, error?: string }> {
    try {
      if (!model || model.trim() === '') {
        return { success: false, error: 'Model name is required' }
      }

      const modelClient = this.createModelClient(model)

      // v7：用 generateText 做一次最小调用即可验证连通性
      const { text } = await generateText({
        model: modelClient,
        prompt: 'Hi',
        maxOutputTokens: 1,
      })

      if (text !== undefined && text !== null) {
        this.logger.info(`✅ Connection validation successful for ${this.format} provider`)
        return { success: true }
      }

      return { success: false, error: 'Failed to get response from API' }
    }
    catch (error: any) {
      const errorMessage = error?.message || 'Unknown error'
      this.logger.error(`❌ Connection validation failed: ${errorMessage}`)

      let friendlyError = errorMessage
      if (errorMessage.includes('Not Found')) {
        friendlyError = `Model "${model}" not found. Please check:
1. The model name is correct
2. The model is available in your API plan
3. The API key has access to this model`
      }
      else if (errorMessage.includes('401') || errorMessage.includes('Unauthorized')) {
        friendlyError = `Invalid API key. Please check:
1. The API key is correct
2. The API key has not expired
3. The API key has the necessary permissions`
      }
      else if (errorMessage.includes('404')) {
        friendlyError = `API endpoint not found. Please check:
1. The Base URL is correct
2. The API endpoint exists`
      }

      return { success: false, error: friendlyError }
    }
  }
}

/**
 * 创建 AI 提供商实例的工厂函数
 */
export async function createAProvider(
  provider: ProviderConfigSchema,
  options: { logger?: ILogger } = {},
): Promise<MultiProvider> {
  const format = provider.apiMode

  return new MultiProvider({
    baseUrl: provider.baseUrl || '',
    apiKey: provider.apiKey || '',
    format,
    logger: options.logger,
  })
}
