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
import { canonicalizeWorkspacePath } from '../../data/permissions/canonicalizePermissionInput'
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
import { extractMessageText } from '../utils/messageContent'
import { createPersistedTurnEmitter } from './persistedTurn'

export class SessionRuntime {
  private readonly promptMemorySnapshots = new Map<string, { memory?: string, soul?: string, user?: string } | undefined>()
  private readonly browserSessions: BrowserSessionManager | null

  constructor(
    private readonly config: AgentRuntimeConfig,
    private readonly taskStore: TaskStore,
  ) {
    this.browserSessions = config.browser ? new BrowserSessionManager(config.browser, config.browserAuthState) : null
  }

  async prepareTask(options: AgentRuntimeStartTaskOptions): Promise<{ input: RuntimeStartInput, createEventEmitter: (taskId: string) => IAgentEventEmitter, conversation: Awaited<ReturnType<ISessionStore['getConversation']>> }> {
    const store = requireSessionStore(this.config)
    const userText = extractMessageText(options.messageContent)
    if (!userText) {
      throw new Error('invalid start task options: missing user text')
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

    // Turn 入口统一 canonical workspace identity：realpath + normalize
    // 后续任务快照、规则分组和匹配都使用同一身份
    const workspacePath = canonicalizeWorkspacePath(options.workspacePath)
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

    // 保留消息原始内容（referencedFiles 已被删除，@ 引用已包含在文本中）
    let userContent: LoopMessage['content']
    if (userMessage.content.length > 0) {
      userContent = await contentBlocksToLoopMessageContent(userMessage.content, loadFileData)
    }
    else {
      userContent = [{ type: 'text', text: userText }]
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
      workspacePath,
      mode,
      browserSession: this.browserSessions?.get(conversation.id),
      turnSource: options.turnSource,
      runId: userMessage.id,
    })
    const memory = await this.getPromptMemorySnapshot(conversation.id)
    const systemPrompt = createLoopSystemPrompt(
      workspacePath,
      currentConversation?.conversationInstructions,
      memory,
    )

    const turnId = userMessage.id

    // Create task first so we can pass taskId to the event emitter
    const taskSnapshot = {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      userText,
      workspacePath,
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
      temperature: options.modelSettings?.temperature,
      maxOutputTokens: options.modelSettings?.maxOutputTokens,
      reasoningEffort: options.modelSettings?.reasoningEffort,
      compaction: compactionSettings,
      preTurnContextEvents: preTurnCompaction.contextEvent ? [preTurnCompaction.contextEvent] : undefined,
    }

    return {
      input: taskSnapshot,
      createEventEmitter: taskId => createPersistedTurnEmitter(store, this.config.eventEmitter, turnId, conversation.id, () => this.taskStore.takePendingSteeringMessages(taskId)),
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
    this.taskStore.enqueueSteeringInput(task.taskId, { messageId, text, turnId })

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
}): Promise<{ compacted: boolean, messages: LoopMessage[], contextEvent?: unknown }> {
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
  return {
    compacted: result.status === 'compacted',
    messages: result.messages,
    contextEvent: result.status === 'compacted'
      ? {
          kind: 'compaction',
          trigger: 'automatic',
          compactedThroughMessageId: result.compactedThroughMessageId,
          input: {
            contextEntries,
            pendingUserMessage,
            settings,
          },
          output: {
            messages: result.messages,
            summaryText: result.summaryText,
            usage: result.usage,
          },
        }
      : undefined,
  }
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
