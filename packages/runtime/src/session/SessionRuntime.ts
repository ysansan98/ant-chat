import type {
  AgentRuntimeConfig,
  AgentRuntimeStartTaskOptions,
  AgentRuntimeStartTaskResult,
  CompactionSettingsSchema,
  IAgentEventEmitter,
  IAIProvider,
  ISessionStore,
  LoopMessage,
} from '@ant-chat/shared'
import type { RuntimeStartInput, RuntimeStartResult } from './types'
import {
  compactMessages,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
} from '../loop/compaction'
import {
  buildConversationContextMessages,
  createLoopSystemPrompt,
} from '../loop/loopContext'
import { buildPromptWithTurnContext } from './turnContext'

const DEFAULT_CONVERSATION_TITLE = 'Untitled'
const STREAM_UPDATE_INTERVAL_MS = 80

export class SessionRuntime {
  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly listActiveTasks: (conversationId?: string) => unknown[],
    private readonly startLoopTask: (
      input: RuntimeStartInput,
      runtime?: {
        eventEmitter?: IAgentEventEmitter
        onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<{ messages: LoopMessage[] }>
      },
    ) => Promise<RuntimeStartResult>,
  ) {}

  async startTask(options: AgentRuntimeStartTaskOptions): Promise<AgentRuntimeStartTaskResult> {
    const store = requireSessionStore(this.config)
    const prompt = options.prompt.trim()
    if (!prompt) {
      throw new Error('invalid start task options: missing prompt')
    }
    if (!options.modelId.trim()) {
      throw new Error('invalid start task options: missing modelId')
    }
    if (!options.workspacePath.trim()) {
      throw new Error('invalid start task options: missing workspacePath')
    }

    const modelResolver = requireConfig(this.config.modelResolver, 'modelResolver')
    const aiProviderFactory = requireConfig(this.config.aiProviderFactory, 'aiProviderFactory')
    const toolProvider = requireConfig(this.config.toolProvider, 'toolProvider')

    const conversation = options.conversationId
      ? await getExistingConversation(store, options.conversationId)
      : await store.createConversation({
          title: DEFAULT_CONVERSATION_TITLE,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          workspacePath: options.workspacePath,
          settings: {
            modelId: options.modelId,
            systemPrompt: options.chatSettings?.systemPrompt ?? '',
            temperature: options.chatSettings?.temperature ?? 0.7,
            maxTokens: options.chatSettings?.maxTokens ?? 4096,
          },
        })

    if (this.listActiveTasks(conversation.id).length > 0) {
      throw new Error('AGENT_TASK_ALREADY_RUNNING')
    }

    const userMessage = await store.createUserMessage({
      convId: conversation.id,
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text: prompt }],
      images: options.images ?? [],
      attachments: options.attachments ?? [],
    })

    const model = await modelResolver.getModelById(options.modelId)
    if (!model) {
      throw new Error(`Model not found: ${options.modelId}`)
    }
    const provider = await modelResolver.getProviderById(model.serviceProviderId)
    if (!provider) {
      throw new Error(`Provider not found for model: ${model.model}`)
    }

    const aiProvider = await aiProviderFactory(options.modelId, modelResolver)
    const currentConversation = await store.getConversation(conversation.id)
    const historyMessages = await store.getMessages(conversation.id)
    const contextMessages = buildConversationContextMessages(
      historyMessages,
      userMessage.id,
      currentConversation?.settings?.lastCompactedAt,
      currentConversation?.settings?.lastCompactionSummary,
    )

    const enrichedPrompt = buildPromptWithTurnContext({
      prompt,
      referencedFiles: options.referencedFiles,
      selectedSkill: options.selectedSkill,
    })
    const messages: LoopMessage[] = [
      ...contextMessages,
      { role: 'user', content: [{ type: 'text', text: enrichedPrompt }] },
    ]

    const mode = options.mode ?? 'hybrid'
    const tools = await toolProvider(options.workspacePath, mode)
    const systemPrompt = createLoopSystemPrompt(options.workspacePath, options.chatSettings?.systemPrompt)
    const apiMode = provider.apiMode || 'openai'
    const compactionSettings: CompactionSettingsSchema = currentConversation?.settings?.compaction ?? DEFAULT_COMPACTION_SETTINGS

    const eventEmitter = createStoreBackedEventEmitter(store, this.config.eventEmitter)
    const onBeforeTurn = createCompactionGate({
      settings: compactionSettings,
      aiProvider,
      modelName: model.model,
      apiMode,
      summarize: this.config.compactionStrategy?.summarize,
      eventEmitter,
      logger: this.config.logger,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
    })

    const taskLogger = this.config.createTaskLogger?.(conversation.id, userMessage.id)

    const task = await this.startLoopTask(
      {
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        prompt: enrichedPrompt,
        workspacePath: options.workspacePath,
        mode,
        messages,
        systemPrompt,
        tools,
        aiProvider,
        modelName: model.model,
        providerName: provider.name,
        providerId: provider.id,
        apiMode,
        taskLogger,
        temperature: options.chatSettings?.temperature,
        maxTokens: options.chatSettings?.maxTokens,
        compaction: compactionSettings,
      },
      { eventEmitter, onBeforeTurn },
    )

    return {
      ...task,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      conversation,
    }
  }
}

function requireSessionStore(config: AgentRuntimeConfig): ISessionStore {
  return requireConfig(config.sessionStore, 'sessionStore')
}

function requireConfig<T>(value: T | undefined, name: string): T {
  if (!value) {
    throw new Error(`AgentRuntime missing required config: ${name}`)
  }
  return value
}

async function getExistingConversation(store: ISessionStore, id: string) {
  const conversation = await store.getConversation(id)
  if (!conversation) {
    throw new Error(`Conversation not found: ${id}`)
  }
  return conversation
}

function createStoreBackedEventEmitter(store: ISessionStore, delegate: IAgentEventEmitter): IAgentEventEmitter {
  const turns = new Map<string, {
    msgId: string
    modelText: string
    reasoningText: string
    latestUsage: Record<string, number> | undefined
    lastUpdateAt: number
  }>()

  async function flushTurn(meta: NonNullable<ReturnType<typeof turns.get>>) {
    const message = await store.updateAssistantMessage(meta.msgId, {
      role: 'assistant',
      status: 'loading',
      content: [{ type: 'text', text: meta.modelText.trim() || '...' }],
      reasoningContent: meta.reasoningText,
      usage: meta.latestUsage,
    })
    await delegate.emitMessageUpdated?.(message)
  }

  return {
    async emitTaskUpdated(task) {
      await delegate.emitTaskUpdated(task)
    },
    async emitApprovalRequired(taskId, conversationId, pendingAction) {
      await delegate.emitApprovalRequired(taskId, conversationId, pendingAction)
    },
    async emitTurnStarted(params) {
      const msg = await store.createAssistantMessage({
        conversationId: params.conversationId,
        modelInfo: {
          provider: params.model.provider,
          providerId: params.model.providerId,
          model: params.model.name,
        },
      })
      await delegate.emitMessageUpdated?.(msg)
      turns.set(params.conversationId, {
        msgId: msg.id,
        modelText: '',
        reasoningText: '',
        latestUsage: undefined,
        lastUpdateAt: 0,
      })
      await delegate.emitTurnStarted(params)
    },
    async emitTurnChunk(params) {
      const meta = turns.get(params.conversationId)
      if (!meta) {
        await delegate.emitTurnChunk(params)
        return
      }

      meta.modelText = params.accumulatedText
      if (params.chunk.reasoningContent)
        meta.reasoningText += params.chunk.reasoningContent
      if (params.chunk.usage)
        meta.latestUsage = { ...params.chunk.usage }

      const now = Date.now()
      if (now - meta.lastUpdateAt >= STREAM_UPDATE_INTERVAL_MS && (meta.modelText || meta.reasoningText)) {
        meta.lastUpdateAt = now
        await flushTurn(meta)
      }
      await delegate.emitTurnChunk(params)
    },
    async emitTurnToolCalls(params) {
      const meta = turns.get(params.conversationId)
      if (meta) {
        meta.modelText = params.text
        const message = await store.updateAssistantMessage(meta.msgId, {
          role: 'assistant',
          status: 'success',
          content: [{ type: 'text', text: params.text }],
          toolCalls: [...params.toolCalls],
        })
        await delegate.emitMessageUpdated?.(message)
      }
      await delegate.emitTurnToolCalls(params)
    },
    async emitTurnFinished(params) {
      const meta = turns.get(params.conversationId)
      if (meta) {
        await flushTurn(meta)
        const message = await store.updateAssistantMessage(meta.msgId, {
          role: 'assistant',
          status: params.status,
          content: params.status === 'error'
            ? [{ type: 'error', error: params.text }]
            : [{ type: 'text', text: params.text }],
          toolCalls: undefined,
        })
        await delegate.emitMessageUpdated?.(message)
        turns.delete(params.conversationId)
      }
      await delegate.emitTurnFinished(params)
    },
    async emitCompactionSaved(params) {
      await store.saveCompactionState(params)
      await delegate.emitCompactionSaved(params)
    },
  }
}

function createCompactionGate(params: {
  settings: CompactionSettingsSchema
  aiProvider: IAIProvider | null
  modelName: string
  apiMode: string
  summarize?: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal) => Promise<string>
  eventEmitter: IAgentEventEmitter
  logger: AgentRuntimeConfig['logger']
  conversationId: string
  userMessageId: string
}): (ctx: { messages: LoopMessage[], step: number }) => Promise<{ messages: LoopMessage[] }> {
  const { settings, aiProvider, modelName, apiMode, summarize, eventEmitter, logger, conversationId, userMessageId } = params
  let compactionCount = 0

  return async (ctx) => {
    if (!settings.enabled || !aiProvider || !summarize) {
      return { messages: ctx.messages }
    }

    const estimatedTokens = estimateContextTokens(ctx.messages)
    const compResult = await compactMessages({
      messages: ctx.messages,
      preEstimatedTokens: estimatedTokens,
      settings,
      aiProvider,
      model: modelName,
      providerFormat: apiMode,
      logger,
      summarize,
    })

    if (!compResult.compacted) {
      return { messages: ctx.messages }
    }

    compactionCount++
    await eventEmitter.emitCompactionSaved({
      conversationId,
      summary: compResult.summaryText || '',
      compactedAt: Date.now(),
    })

    logger.info('[agent-runtime]', { event: 'context_compacted', conversationId, userMessageId, step: ctx.step, compactionCount, summaryLength: compResult.summaryLength, keptLength: compResult.keptLength, totalMessages: compResult.messages.length })

    return { messages: compResult.messages }
  }
}
