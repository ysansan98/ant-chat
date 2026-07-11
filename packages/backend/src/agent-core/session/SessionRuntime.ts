import type {
  AgentRuntimeConfig,
  AgentRuntimeStartTaskOptions,
  CompactionSettingsSchema,
  IAgentEventEmitter,
  IAIProvider,
  ILogger,
  IMessage,
  ISessionStore,
  LoopMessage,
  ModelInfo,
} from '@ant-chat/shared'
import type { ConversationContextEntry } from '../loop/loopContext'
import type { TaskStore } from '../taskStore'
import type { RuntimeStartInput } from './types'
import { randomUUID } from 'node:crypto'
import {
  DEFAULT_COMPACTION_SETTINGS,
} from '../compaction/compaction'
import { createCompactionStrategy } from '../compaction/compactionStrategy'
import { runCompactionTransaction } from '../compaction/compactionTransaction'
import { getAgentLogger } from '../logger'
import {
  buildConversationContextEntries,
  createLoopSystemPrompt,
} from '../loop/loopContext'
import { BrowserSessionManager } from '../native-tools/tools/browserSessionManager'
import { ToolRegistry } from '../tools/toolRegistry'
import { contentBlocksToLoopMessageContent } from '../utils/attachmentUtils'
import { createPersistedTurnEmitter } from './persistedTurn'
import { buildPromptWithTurnContext } from './turnContext'

export class SessionRuntime {
  private readonly promptMemorySnapshots = new Map<string, { memory?: string, soul?: string, user?: string } | undefined>()
  private readonly browserSessions: BrowserSessionManager | null

  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly taskStore: TaskStore,
  ) {
    this.browserSessions = config.browser ? new BrowserSessionManager(config.browser) : null
  }

  async prepareTask(options: AgentRuntimeStartTaskOptions): Promise<{ input: RuntimeStartInput, createEventEmitter: (taskId: string) => IAgentEventEmitter, dispose: () => void, conversation: Awaited<ReturnType<ISessionStore['getConversation']>> }> {
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

    const aiProvider = options.aiProvider
    if (!aiProvider) {
      throw new Error('AgentRuntime requires a prepared AI provider')
    }
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
      reasoningEffort: options.modelSettings?.reasoningEffort,
      compaction: compactionSettings,
    }

    return {
      input: taskSnapshot,
      createEventEmitter: taskId => createPersistedTurnEmitter(store, this.config.eventEmitter, turnId, conversation.id, () => this.taskStore.takePendingSteeringMessages(taskId)),
      dispose: () => taskLogger?.close(),
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
  summarize: NonNullable<AgentRuntimeConfig['compactionStrategy']>['summarize']
  logger: ILogger
  conversationId: string
  modelInfo: ModelInfo
  store: ISessionStore
}): Promise<{ compacted: boolean, messages: LoopMessage[] }> {
  const { contextEntries, pendingUserMessage, settings, aiProvider, modelName, contextLength, summarize, logger, conversationId, modelInfo, store } = params
  const contextMessages = contextEntries.map(entry => entry.message)
  if (!aiProvider) {
    return { compacted: false, messages: contextMessages }
  }
  const result = await runCompactionTransaction({
    trigger: 'automatic',
    conversationId,
    contextEntries,
    pendingUserMessage,
    settings,
    prepare: async () => ({ aiProvider, modelName, modelInfo }),
    summarize,
    contextLength,
    logger,
    persistence: {
      createLoading: async convId => await store.createEventMessage({ convId, role: 'event', status: 'loading', content: [{ type: 'text', text: '正在压缩上下文...' }], eventType: 'compaction' }),
      update: async (eventId, patch) => { await store.updateEventMessage(eventId, { role: 'event', eventType: 'compaction', status: patch.status, content: [{ type: 'text', text: patch.text }], modelInfo: patch.modelInfo, usage: patch.usage, compactedThroughMessageId: patch.compactedThroughMessageId }) },
      delete: async eventId => await store.deleteEventMessage(eventId),
    },
  })
  return { compacted: result.status === 'compacted', messages: result.messages }
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
