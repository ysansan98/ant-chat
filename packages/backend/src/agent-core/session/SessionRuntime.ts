import type {
  AgentRuntimeConfig,
  AgentRuntimeStartTaskOptions,
  AgentRuntimeStartTaskResult,
  CompactionSettingsSchema,
  CompactionStrategy,
  IAgentEventEmitter,
  IAIProvider,
  ILogger,
  IMessage,
  ISessionStore,
  LoopMessage,
  MessageContent,
  ModelInfo,
} from '@ant-chat/shared'
import type { ConversationContextEntry } from '../loop/loopContext'
import type { TaskStore } from '../taskStore'
import type { BeforeTurnResult, RuntimeStartInput, RuntimeStartResult } from './types'
import { randomUUID } from 'node:crypto'
import { createProvider } from '../ai-providers/factory'
import {
  calculateContextTokens,
  compactMessages,
  DEFAULT_COMPACTION_SETTINGS,
  planCompaction,
} from '../compaction/compaction'
import { createCompactionStrategy } from '../compaction/compactionStrategy'
import { getAgentLogger } from '../logger'
import {
  buildConversationContextEntries,
  createLoopSystemPrompt,
} from '../loop/loopContext'
import { BrowserSessionManager } from '../native-tools/tools/browserSessionManager'
import { ToolRegistry } from '../tools/toolRegistry'
import { contentBlocksToLoopMessageContent } from '../utils/attachmentUtils'
import { buildPromptWithTurnContext } from './turnContext'

const STREAM_UPDATE_INTERVAL_MS = 80

export class SessionRuntime {
  private readonly promptMemorySnapshots = new Map<string, { memory?: string, soul?: string, user?: string } | undefined>()
  private readonly browserSessions: BrowserSessionManager | null

  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly taskStore: TaskStore,
    private readonly startLoopTask: (
      input: RuntimeStartInput,
      runtime?: {
        eventEmitter?: IAgentEventEmitter
        onBeforeTurn?: (ctx: { messages: LoopMessage[], step: number }) => Promise<BeforeTurnResult>
      },
    ) => Promise<RuntimeStartResult>,
  ) {
    this.browserSessions = config.browser ? new BrowserSessionManager(config.browser) : null
  }

  async startTask(options: AgentRuntimeStartTaskOptions): Promise<AgentRuntimeStartTaskResult> {
    const store = requireSessionStore(this.config)
    const prompt = options.prompt.trim()
    if (!prompt) {
      throw new Error('invalid start task options: missing prompt')
    }
    if (!options.model?.id.trim()) {
      throw new Error('invalid start task options: missing model')
    }
    if (!options.provider?.id.trim()) {
      throw new Error('invalid start task options: missing provider')
    }
    if (!options.workspacePath.trim()) {
      throw new Error('invalid start task options: missing workspacePath')
    }
    if (!options.conversationId?.trim()) {
      throw new Error('invalid start task options: missing conversationId')
    }
    if (!options.userMessageId?.trim()) {
      throw new Error('invalid start task options: missing userMessageId')
    }

    const { model, provider } = options
    const loadFileData = createCachedLoadFileData(this.config.loadFileData)

    const conversation = await getExistingConversation(store, options.conversationId)

    const aiProvider = options.aiProvider ?? (this.config.aiProviderFactory
      ? await this.config.aiProviderFactory({ model, provider })
      : await createProvider(provider))
    const currentConversation = await store.getConversation(conversation.id)
    const allMessages = await store.getMessages(conversation.id)
    const userMessage = allMessages.find(message => message.id === options.userMessageId && message.role === 'user')
    if (!userMessage) {
      throw new Error(`User message not found: ${options.userMessageId}`)
    }

    const enrichedPrompt = buildPromptWithTurnContext({
      prompt,
      referencedFiles: options.referencedFiles,
    })

    // Build user content.
    let userContent: LoopMessage['content']
    if (userMessage.content.length > 0) {
      // 保留附件块，同时让 agent 上下文使用带引用信息的提示词。
      const contentWithEnrichedPrompt = userMessage.content.map((block) => {
        if (block.type === 'text') {
          return { ...block, text: enrichedPrompt }
        }
        return block
      })
      userContent = await contentBlocksToLoopMessageContent(contentWithEnrichedPrompt, loadFileData)
    }
    else {
      userContent = [{ type: 'text', text: enrichedPrompt }]
    }

    const historyMessages = allMessages.filter(message => message.id !== userMessage.id)
    const contextEntries = await buildConversationContextEntries(
      historyMessages,
      undefined,
      loadFileData,
    )

    const apiMode = provider.apiMode || 'openai'
    const compactionSettings: CompactionSettingsSchema = currentConversation?.settings?.compaction ?? DEFAULT_COMPACTION_SETTINGS
    const preTurnCompaction = await compactPersistedHistoryBeforeTurn({
      contextEntries,
      pendingUserMessage: { role: 'user', content: userContent },
      settings: compactionSettings,
      aiProvider,
      modelName: model.model,
      contextLength: model.contextLength,
      summarize: (this.config.compactionStrategy ?? createCompactionStrategy()).summarize,
      logger: getAgentLogger(this.config),
      conversationId: conversation.id,
      modelInfo: {
        provider: provider.name,
        providerId: provider.id,
        model: model.model,
      },
      store,
    })
    if (preTurnCompaction.compacted) {
      this.promptMemorySnapshots.delete(conversation.id)
    }

    const messages: LoopMessage[] = [
      ...preTurnCompaction.messages,
      { role: 'user', content: userContent },
    ]

    const mode = options.mode ?? 'hybrid'
    const registry = await ToolRegistry.create({
      config: this.config,
      workspacePath: options.workspacePath,
      mode,
      browserSession: this.browserSessions?.get(conversation.id),
      turnSource: options.turnSource,
    })
    const memory = await this.getPromptMemorySnapshot(conversation.id)
    const systemPrompt = createLoopSystemPrompt(options.workspacePath, options.modelSettings?.systemPrompt, memory)

    const turnId = userMessage.id

    const taskLogger = this.config.createTaskLogger?.(conversation.id, userMessage.id)

    // Create task first so we can pass taskId to the event emitter
    const taskSnapshot = {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      prompt: enrichedPrompt,
      workspacePath: options.workspacePath,
      mode,
      turnSource: options.turnSource,
      messages,
      systemPrompt,
      registry,
      aiProvider,
      modelName: model.model,
      providerName: provider.name,
      providerId: provider.id,
      apiMode,
      taskLogger,
      temperature: options.modelSettings?.temperature,
      maxTokens: options.modelSettings?.maxTokens,
      compaction: compactionSettings,
    }

    const eventEmitter = createStoreBackedEventEmitter(store, this.config.eventEmitter, turnId, this.taskStore)

    const task = await this.startLoopTask(
      taskSnapshot,
      { eventEmitter },
    )

    return {
      ...task,
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      conversation,
    }
  }

  async injectSteering(conversationId: string, text: string): Promise<IMessage> {
    const activeTasks = this.taskStore.listActive(conversationId)
    if (activeTasks.length === 0)
      throw new Error('AGENT_TASK_NOT_RUNNING')

    const task = activeTasks[0]
    const turnId = task.userMessageId
    const messageId = `msg-${randomUUID()}`
    const message: IMessage = {
      id: messageId,
      convId: conversationId,
      createdAt: Date.now(),
      role: 'user',
      status: 'success',
      content: [{ type: 'text', text }],
      turnId,
    }

    this.taskStore.enqueueSteeringMessage(task.taskId, { id: messageId, text, turnId })
    this.taskStore.enqueueSteeringInput(task.taskId, { text, turnId })

    return message
  }

  async closeConversation(conversationId: string): Promise<void> {
    this.promptMemorySnapshots.delete(conversationId)
    await this.browserSessions?.close(conversationId, true)
  }

  async dispose(): Promise<void> {
    this.promptMemorySnapshots.clear()
    await this.browserSessions?.dispose()
  }

  private async getPromptMemorySnapshot(conversationId: string): Promise<{ memory?: string, soul?: string, user?: string } | undefined> {
    if (!this.promptMemorySnapshots.has(conversationId)) {
      this.promptMemorySnapshots.set(conversationId, await readPromptMemory(this.config))
    }
    return this.promptMemorySnapshots.get(conversationId)
  }
}

async function compactPersistedHistoryBeforeTurn(params: {
  contextEntries: ConversationContextEntry[]
  pendingUserMessage: LoopMessage
  settings: CompactionSettingsSchema
  aiProvider: IAIProvider | null
  modelName: string
  contextLength: number
  summarize?: CompactionStrategy['summarize']
  logger: ILogger
  conversationId: string
  modelInfo: ModelInfo
  store: ISessionStore
}): Promise<{ compacted: boolean, messages: LoopMessage[] }> {
  const { contextEntries, pendingUserMessage, settings, aiProvider, modelName, contextLength, summarize, logger, conversationId, modelInfo, store } = params
  const contextMessages = contextEntries.map(entry => entry.message)
  if (!aiProvider || !summarize) {
    return { compacted: false, messages: contextMessages }
  }

  const contextTokens = calculateContextTokens(contextEntries, pendingUserMessage)
  const plan = planCompaction({
    messages: contextMessages,
    settings,
    trigger: 'automatic',
    contextTokens,
    contextLength,
  })
  if (!plan.eligible) {
    return { compacted: false, messages: contextMessages }
  }

  const loadingEvent = await store.createEventMessage({
    convId: conversationId,
    role: 'event',
    status: 'loading',
    content: [{ type: 'text', text: '正在压缩上下文...' }],
    eventType: 'compaction',
  })

  let result: Awaited<ReturnType<typeof compactMessages>>
  try {
    result = await compactMessages({
      messages: contextMessages,
      settings,
      aiProvider,
      model: modelName,
      logger,
      summarize,
      trigger: 'automatic',
      contextTokens,
      contextLength,
      plan,
    })
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    await store.updateEventMessage(loadingEvent.id, {
      role: 'event',
      status: 'error',
      content: [{ type: 'text', text: errorMessage }],
      eventType: 'compaction',
      modelInfo,
    })
    return { compacted: false, messages: contextMessages }
  }

  if (!result.compacted) {
    await store.updateEventMessage(loadingEvent.id, {
      role: 'event',
      status: 'error',
      content: [{ type: 'text', text: result.summaryError || '上下文压缩未生成结果。' }],
      eventType: 'compaction',
      modelInfo,
      usage: result.usage,
    })
    return { compacted: false, messages: contextMessages }
  }

  const compactedThroughMessageId = contextEntries[plan.toSummarizeCount - 1]?.sourceMessageId
  if (!compactedThroughMessageId) {
    await store.updateEventMessage(loadingEvent.id, {
      role: 'event',
      status: 'error',
      content: [{ type: 'text', text: 'Compaction did not produce a persisted message boundary.' }],
      eventType: 'compaction',
      modelInfo,
      usage: result.usage,
    })
    return { compacted: false, messages: contextMessages }
  }

  await store.updateEventMessage(loadingEvent.id, {
    role: 'event',
    status: 'success',
    content: [{ type: 'text', text: result.summaryText || '' }],
    eventType: 'compaction',
    compactedThroughMessageId,
    modelInfo,
    usage: result.usage,
  })

  return { compacted: true, messages: result.messages }
}

async function readPromptMemory(config: AgentRuntimeConfig): Promise<{ memory?: string, soul?: string, user?: string } | undefined> {
  if (!config.memoryReader) {
    return undefined
  }

  const [soul, user, memory] = await Promise.all([
    config.memoryReader.readSoul(),
    config.memoryReader.readUserMemory(),
    config.memoryReader.readMemory(),
  ])
  return { memory, soul, user }
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

function createCachedLoadFileData(loadFileData: AgentRuntimeConfig['loadFileData']): AgentRuntimeConfig['loadFileData'] {
  if (!loadFileData) {
    return undefined
  }

  const cache = new Map<string, Promise<string | null>>()
  return (fileId) => {
    const cached = cache.get(fileId)
    if (cached) {
      return cached
    }

    const next = loadFileData(fileId)
    cache.set(fileId, next)
    return next
  }
}

async function getExistingConversation(store: ISessionStore, id: string) {
  const conversation = await store.getConversation(id)
  if (!conversation) {
    throw new Error(`Conversation not found: ${id}`)
  }
  return conversation
}

interface TurnMeta {
  msgId: string
  modelText: string
  reasoningText: string
  latestUsage: Record<string, number> | undefined
  lastUpdateAt: number
  persistedToolCallIds: Set<string>
}

function createStoreBackedEventEmitter(store: ISessionStore, delegate: IAgentEventEmitter, turnId: string, taskStore: TaskStore): IAgentEventEmitter {
  const turns = new Map<string, TurnMeta>()

  function newTurnMeta(msgId: string): TurnMeta {
    return {
      msgId,
      modelText: '',
      reasoningText: '',
      latestUsage: undefined,
      lastUpdateAt: 0,
      persistedToolCallIds: new Set(),
    }
  }

  async function flushTurn(meta: TurnMeta) {
    const message = await store.updateAssistantMessage(meta.msgId, {
      role: 'assistant',
      status: 'loading',
      content: [{ type: 'text', text: meta.modelText.trim() || '...' }],
      reasoningContent: meta.reasoningText,
      usage: meta.latestUsage,
    })
    await delegate.emitMessageUpdated?.(message)
  }

  async function persistPendingSteeringMessages() {
    const activeTask = taskStore.listActive().find(task => task.userMessageId === turnId)
    if (!activeTask)
      return
    const pending = taskStore.takePendingSteeringMessages(activeTask.taskId)
    for (const input of pending) {
      const msg = await store.createUserMessage({
        id: input.id,
        convId: activeTask.conversationId,
        role: 'user',
        status: 'success',
        content: [{ type: 'text', text: input.text }],
        turnId: input.turnId,
      })
      await delegate.emitMessageUpdated?.(msg)
    }
  }

  const emitter: IAgentEventEmitter = {
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
        turnId,
      })
      await delegate.emitMessageUpdated?.(msg)
      turns.set(params.conversationId, newTurnMeta(msg.id))
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
      if (!meta) {
        await delegate.emitTurnToolCalls(params)
        return
      }

      meta.modelText = params.text

      const contentBlocks: Array<Record<string, unknown>> = []
      if (params.text) {
        contentBlocks.push({ type: 'text', text: params.text })
      }

      for (const tc of params.toolCalls) {
        if (!meta.persistedToolCallIds.has(tc.toolCallId)) {
          meta.persistedToolCallIds.add(tc.toolCallId)
        }
        contentBlocks.push(tc)
      }

      const message = await store.updateAssistantMessage(meta.msgId, {
        role: 'assistant',
        status: 'success',
        content: contentBlocks as any,
      })
      await delegate.emitMessageUpdated?.(message)
      await delegate.emitTurnToolCalls(params)
    },
    async emitTurnToolResults(params) {
      for (const result of params.results) {
        const msg = await store.createToolMessage({
          convId: params.conversationId,
          role: 'tool',
          status: result.isError ? 'error' : 'success',
          content: [result],
          turnId,
        })
        await delegate.emitMessageUpdated?.(msg)
      }

      // Persist steering messages AFTER tool results to maintain correct message order
      await persistPendingSteeringMessages()

      await delegate.emitTurnToolResults?.(params)
    },
    async emitTurnFinished(params) {
      const meta = turns.get(params.conversationId)
      if (meta) {
        await flushTurn(meta)
        const content: MessageContent = params.status === 'error'
          ? withErrorContent(meta.modelText, params.text)
          : [{ type: 'text', text: params.text }]
        const message = await store.updateAssistantMessage(meta.msgId, {
          role: 'assistant',
          status: params.status,
          content,
          durationMs: params.durationMs,
        })
        await delegate.emitMessageUpdated?.(message)
        turns.delete(params.conversationId)
      }

      // Also flush here: model may finish without further tool calls,
      // so emitTurnToolResults would never run.
      await persistPendingSteeringMessages()

      await delegate.emitTurnFinished(params)
    },
  }

  return emitter
}

function withErrorContent(modelText: string, errorText: string): MessageContent {
  const content: MessageContent = modelText.trim()
    ? [{ type: 'text', text: modelText }]
    : []
  content.push({ type: 'error', error: errorText })
  return content
}
