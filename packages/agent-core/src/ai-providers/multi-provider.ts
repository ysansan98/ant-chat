import type { AnthropicProvider } from '@ai-sdk/anthropic'
import type { DeepSeekProvider } from '@ai-sdk/deepseek'
import type { GoogleGenerativeAIProvider } from '@ai-sdk/google'
import type { OpenAIProvider } from '@ai-sdk/openai'
import type { ProviderConfigSchema } from '@ant-chat/shared'
import type { LanguageModelUsage } from 'ai'
import type { ProviderFormat } from './types'
import process from 'node:process'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createDeepSeek } from '@ai-sdk/deepseek'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { dynamicTool, generateText, jsonSchema, streamText } from 'ai'
import { AgentError } from '../AgentError'

/**
 * 多提供商 AI 提供商
 * 支持 DeepSeek、OpenAI、Gemini、Anthropic 等多种 AI 提供商
 */
export class MultiProvider {
  private client: DeepSeekProvider | OpenAIProvider | GoogleGenerativeAIProvider | AnthropicProvider
  private format: ProviderFormat
  private logger = {
    info: (msg: string, ...args: any[]) => console.log(`[MultiProvider] ${msg}`, ...args),
    debug: (msg: string, ...args: any[]) => console.log(`[MultiProvider DEBUG] ${msg}`, ...args),
    error: (msg: string, ...args: any[]) => console.error(`[MultiProvider ERROR] ${msg}`, ...args),
    warn: (msg: string, ...args: any[]) => console.warn(`[MultiProvider WARN] ${msg}`, ...args),
  }

  private normalizeUsage(usage?: LanguageModelUsage) {
    if (!usage) {
      return undefined
    }

    return {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      reasoningTokens: usage.reasoningTokens,
      cachedInputTokens: usage.cachedInputTokens,
    }
  }

  private normalizeError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }

  constructor(options: {
    baseUrl: string
    apiKey: string
    format?: ProviderFormat
  }) {
    this.format = options.format || 'openai'

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

    // 根据格式初始化不同的客户端
    switch (this.format) {
      case 'deepseek':
        this.logger.debug('Creating DeepSeek client with baseURL:', options.baseUrl)
        this.client = createDeepSeek({
          apiKey: options.apiKey,
          baseURL: options.baseUrl,
        })
        break

      case 'openai':
        this.logger.debug('Creating OpenAI client with baseURL:', options.baseUrl)
        this.client = createOpenAI({
          apiKey: options.apiKey,
          baseURL: options.baseUrl,
        })
        break

      case 'google':
        this.logger.debug('Creating Google client with baseURL:', options.baseUrl)
        this.client = createGoogleGenerativeAI({
          apiKey: options.apiKey,
          baseURL: options.baseUrl,
        })
        break

      case 'anthropic':
        this.logger.debug('Creating Anthropic client with baseURL:', options.baseUrl)
        this.client = createAnthropic({
          apiKey: options.apiKey,
          baseURL: options.baseUrl,
        })
        break

      default:
        throw new Error(`Unsupported format: ${this.format}`)
    }
  }

  /**
   * 创建模型客户端
   */
  private createModelClient(model: string): any {
    if (!this.client) {
      throw new Error('Client not initialized')
    }

    if (!model || model.trim() === '') {
      const errorMsg = `Model name is required for ${this.format} provider. Please provide a valid model name.`
      this.logger.error(errorMsg)
      throw new Error(errorMsg)
    }

    this.logger.debug(`Creating model client for model: ${model}`)

    // 对于OpenAI格式，使用 Chat Completions API（而不是默认的 Responses API）
    if (this.format === 'openai') {
      const modelClient = this.client.chat(model)
      this.logger.debug('OpenAI Chat model client created successfully')
      return modelClient
    }

    // 对于DeepSeek格式，直接使用默认方式
    if (this.format === 'deepseek') {
      const modelClient = this.client(model)
      this.logger.debug('DeepSeek model client created successfully')
      return modelClient
    }

    // 对于其他格式，使用默认方式
    const modelClient = this.client(model)
    this.logger.debug('Model client created successfully')
    return modelClient
  }

  /**
   * 将内部消息格式转换为 AI SDK 消息格式
   */
  private transformToAISdkMessages(messages: any[], systemPrompt: string) {
    const aiSdkMessages: any[] = []

    // 添加系统提示词
    if (systemPrompt.length > 0) {
      aiSdkMessages.push({
        role: 'system' as const,
        content: systemPrompt,
      })
    }

    // 转换消息
    for (const message of messages) {
      if (message.role === 'user') {
        // 处理用户消息
        const parts: any[] = []

        for (const content of message.content) {
          if (content.type === 'text') {
            parts.push({
              type: 'text' as const,
              text: content.text,
            })
          }
          else if (content.type === 'image') {
            parts.push({
              type: 'image' as const,
              image: content.data,
              mimeType: content.mimeType,
            })
          }
        }

        aiSdkMessages.push({
          role: 'user' as const,
          content: parts.length === 1 && parts[0].type === 'text'
            ? parts[0].text
            : parts,
        })
      }
      else if (message.role === 'assistant') {
        // 处理助手消息
        const parts: any[] = []

        for (const content of message.content) {
          if (content.type === 'text') {
            parts.push({
              type: 'text' as const,
              text: content.text,
            })
          }
          else if (content.type === 'tool-call') {
            parts.push({
              type: 'tool-call' as const,
              toolCallId: content.toolCallId,
              toolName: content.toolName,
              input: content.args,
            })
          }
          else if (content.type === 'image') {
            parts.push({
              type: 'file' as const,
              data: content.data,
              mediaType: content.mimeType,
            })
          }
        }

        aiSdkMessages.push({
          role: 'assistant' as const,
          content: parts,
        })
      }
      else if (message.role === 'tool') {
        // 处理工具结果消息
        const parts: any[] = []

        for (const content of message.content) {
          if (content.type === 'tool-result') {
            const outputType = content.isError ? 'error-text' : 'text'
            parts.push({
              type: 'tool-result' as const,
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
          aiSdkMessages.push({
            role: 'tool' as const,
            content: parts,
          })
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
      maxTokens?: number
      systemPrompt: string
    }
    tools?: Array<{
      name: string
      description?: string
      inputSchema: Record<string, unknown>
      serverName?: string
    }>
    abortSignal?: AbortSignal
  }) {
    const { messages, modelSettings, abortSignal, tools } = options
    const { model, temperature, maxTokens, systemPrompt } = modelSettings

    // 构建 AI SDK 格式的消息
    const aiSdkMessages = this.transformToAISdkMessages(messages, systemPrompt)

    const aiTools = tools && tools.length > 0
      ? Object.fromEntries(tools.map(item => [item.name, dynamicTool({
          description: item.description,
          inputSchema: jsonSchema(item.inputSchema),
          execute: async () => {
            throw new Error('RUNTIME_EXTERNAL_TOOL_EXECUTION')
          },
        })]))
      : undefined

    // 使用 AI SDK 的流式处理
    let finalUsage: LanguageModelUsage | undefined
    let finishReason: string | undefined

    const result = streamText({
      model: this.createModelClient(model),
      messages: aiSdkMessages,
      temperature,
      maxOutputTokens: maxTokens,
      tools: aiTools,
      abortSignal,
      onFinish: ({ totalUsage, usage, finishReason: reason }) => {
        finalUsage = totalUsage || usage
        finishReason = reason
      },
    })

    // 处理流式响应 - 优先使用 fullStream 支持推理内容
    let usedFullStream = false

    for await (const chunk of result.fullStream) {
      usedFullStream = true

      if (chunk.type === 'reasoning-delta') {
        // 处理推理内容（实时输出）
        yield {
          content: [],
          reasoningContent: chunk.text,
        }
      }
      else if (chunk.type === 'text-delta') {
        // 处理普通文本内容（实时输出）
        const content: any[] = [{ type: 'text', text: chunk.text }]

        yield {
          content,
        }
      }
      else if (chunk.type === 'tool-call') {
        const toolDef = tools?.find(item => item.name === chunk.toolName)
        yield {
          content: [],
          functionCalls: [{
            id: chunk.toolCallId,
            serverName: toolDef?.serverName || 'native',
            toolName: chunk.toolName,
            args: (chunk as any).input || {},
            executeState: 'await' as const,
          }],
        }
      }
      else if (chunk.type === 'finish') {
        finalUsage = chunk.totalUsage || finalUsage
        finishReason = (chunk as { finishReason?: string }).finishReason || finishReason
      }
      else if (chunk.type === 'error') {
        throw this.normalizeError(chunk.error)
      }
      else if (chunk.type === 'abort') {
        throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
      }
      else {
        this.logger.warn('not match chunk type: ', chunk.type)
      }
    }
    // 如果模型不支持 fullStream，则使用 textStream
    if (!usedFullStream) {
      this.logger.debug('Using textStream fallback')

      // 处理流式响应
      for await (const chunk of result.textStream) {
        const content: any[] = [{ type: 'text', text: chunk }]

        yield {
          content,
        }
      }

      // 处理推理内容（如果有）- 在流式输出完成后处理
      if (result.reasoningText) {
        const reasoningText = await result.reasoningText
        if (reasoningText) {
          yield {
            content: [],
            reasoningContent: reasoningText,
          }
        }
      }
    }

    const totalUsage = finalUsage || await result.totalUsage
    const normalizedUsage = this.normalizeUsage(totalUsage)
    yield {
      content: [],
      usage: normalizedUsage,
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
      maxTokens?: number
    }
    abortSignal?: AbortSignal
  }): Promise<{ text: string }> {
    const { messages, modelSettings, abortSignal } = options
    const { model, systemPrompt, maxTokens } = modelSettings

    const aiSdkMessages: any[] = []
    if (systemPrompt) {
      aiSdkMessages.push({ role: 'system', content: systemPrompt })
    }
    for (const msg of messages) {
      aiSdkMessages.push({ role: msg.role, content: msg.content })
    }

    const result = await generateText({
      model: this.createModelClient(model),
      messages: aiSdkMessages,
      maxOutputTokens: maxTokens,
      abortSignal,
    })

    return { text: result.text }
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
      const result = streamText({
        model: this.createModelClient(model),
        prompt: context,
      })

      return result.text
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

      const result = await streamText({
        model: modelClient,
        prompt: 'Hi',
        maxOutputTokens: 1,
      })

      const text = await result.text
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
): Promise<MultiProvider> {
  const format = provider.apiMode

  return new MultiProvider({
    baseUrl: provider.baseUrl || '',
    apiKey: provider.apiKey || '',
    format,
  })
}
