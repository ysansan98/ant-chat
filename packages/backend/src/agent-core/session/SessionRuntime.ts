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
import type { ImagePlaceholderItem } from '../utils/attachmentUtils'
import type { RuntimeStartInput } from './types'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { canonicalizeWorkspacePath } from '../../workspace/workspaceIdentity'
import {
  DEFAULT_COMPACTION_SETTINGS,
} from '../compaction/compaction'
import { createCompactionStrategy } from '../compaction/compactionStrategy'
import { runCompactionTransaction } from '../compaction/compactionTransaction'
import { runPostCompactHook, runPreCompactHook } from '../hooks/lifecycleHooks'
import { recordHookObservation } from '../hooks/observability'
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
    // 目标模型不支持图片输入时，把图片附件替换为识别占位符文本（由 agent 调用
    // `ant-chat image recognize --file-id <id>` 识别），避免把 image part 硬发给纯文本模型。
    const modelSupportsImage = model.capabilities?.inputModalities?.includes('image') === true
    let projectedUnsupportedImages: ImagePlaceholderItem[] = []
    const attachmentOptions: Parameters<typeof contentBlocksToLoopMessageContent>[2] = modelSupportsImage
      ? undefined
      : {
          imageToPlaceholder: {
            onReplaced: (items) => {
              projectedUnsupportedImages = items
            },
          },
        }

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
      userContent = await contentBlocksToLoopMessageContent(userMessage.content, loadFileData, attachmentOptions)
    }
    else {
      userContent = [{ type: 'text', text: userText }]
    }

    // UserPromptSubmit hook 的 additionalContext：只进入本轮 loop，不持久化为用户消息。
    const hookAdditionalContext = options.hookAdditionalContext?.trim()
    if (hookAdditionalContext) {
      userContent = [...userContent, { type: 'text', text: hookAdditionalContext }]
    }

    const historyMessages = allMessages.filter(message => message.id !== userMessage.id)
    const contextEntries = await buildConversationContextEntries(
      historyMessages,
      undefined,
      loadFileData,
      attachmentOptions,
    )

    const apiMode = provider.apiMode || 'openai'
    const compactionSettings: CompactionSettingsSchema = currentConversation?.settings?.compaction ?? DEFAULT_COMPACTION_SETTINGS
    // PreCompact hook：deny 或 continue:false 阻止本次自动压缩；失败隔离后按允许处理。
    const preCompact = await runPreCompactHook({
      config: this.config,
      conversationId: conversation.id,
      workspacePath,
      trigger: 'automatic',
    })
    const preTurnCompaction = preCompact.allowed
      ? await compactPersistedHistoryBeforeTurn({
          contextEntries,
          pendingUserMessage: { role: 'user', content: userContent },
          settings: compactionSettings,
          aiProvider,
          modelName: model.model,
          contextLength: model.contextLength,
          summarize: (this.config.compactionStrategy ?? createCompactionStrategy(undefined, conversation.id)).summarize,
          logger: getAgentLogger(this.config),
          conversationId: conversation.id,
          modelInfo: {
            provider: provider.name,
            providerId: provider.id,
            model: model.model,
          },
          store,
        })
      : { compacted: false, messages: contextEntries.map(entry => entry.message) }
    if (preCompact.allowed) {
      await runPostCompactHook({
        config: this.config,
        conversationId: conversation.id,
        workspacePath,
        trigger: 'automatic',
        status: preTurnCompaction.compacted ? 'compacted' : 'skipped',
      })
    }
    else {
      getAgentLogger(this.config).warn(`PreCompact hook 阻止自动压缩：${preCompact.reason ?? '未提供原因'}`)
    }
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
    let systemPrompt = createLoopSystemPrompt(
      workspacePath,
      currentConversation?.conversationInstructions,
      memory,
    )

    // SessionStart hook：additionalContext 追加到 systemPrompt；失败只记日志。
    const sessionStartContext = await this.runSessionStartHook({
      conversationId: conversation.id,
      workspacePath,
      turnSource: options.turnSource,
    })
    if (sessionStartContext)
      systemPrompt = `${systemPrompt}\n\n${sessionStartContext}`

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
      reasoningEffort: options.modelSettings?.reasoningEffort,
      compaction: compactionSettings,
      preTurnContextEvents: buildPreTurnContextEvents(preTurnCompaction.contextEvent, sessionStartContext, hookAdditionalContext),
      projectedUnsupportedImages,
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
    await this.runSessionEndHook(conversationId, 'close')
    this.promptMemorySnapshots.delete(conversationId)
    await this.browserSessions?.close(conversationId, true)
  }

  async dispose(): Promise<void> {
    const conversationIds = [...this.promptMemorySnapshots.keys()]
    await Promise.all(conversationIds.map(conversationId => this.runSessionEndHook(conversationId, 'dispose')))
    this.promptMemorySnapshots.clear()
    await this.browserSessions?.dispose()
  }

  /** SessionStart hook：仅消费 additionalContext，失败只记日志。 */
  private async runSessionStartHook(params: {
    conversationId: string
    workspacePath: string
    turnSource?: AgentRuntimeStartTaskOptions['turnSource']
  }): Promise<string | undefined> {
    const hooks = this.config.hooks
    if (!hooks)
      return undefined
    try {
      const result = await hooks.run('SessionStart', {
        hook_event_name: 'SessionStart',
        session_id: params.conversationId,
        conversation_id: params.conversationId,
        cwd: params.workspacePath,
        timestamp: Date.now(),
        source: params.turnSource?.type ?? 'interactive',
        workspace_path: params.workspacePath,
      }, { cwd: params.workspacePath })
      recordHookObservation(this.config, 'SessionStart', result)
      if (result.decision && result.decision !== 'allow') {
        // SessionStart 不提供收紧能力；deny/ask 无对应语义，按无决策继续。
        getAgentLogger(this.config).warn(`SessionStart hook 返回了不支持的决策 ${result.decision}，已忽略`)
      }
      return result.additionalContext
    }
    catch (error) {
      getAgentLogger(this.config).warn('SessionStart hook 执行失败，按无决策继续', error)
      return undefined
    }
  }

  /** SessionEnd hook：观察类，输出不可干预会话关闭，3s 超时。 */
  private async runSessionEndHook(conversationId: string, reason: 'close' | 'dispose'): Promise<void> {
    const hooks = this.config.hooks
    if (!hooks)
      return
    const workspacePath = await this.resolveWorkspacePath(conversationId)
    try {
      const result = await hooks.run('SessionEnd', {
        hook_event_name: 'SessionEnd',
        session_id: conversationId,
        conversation_id: conversationId,
        cwd: workspacePath,
        timestamp: Date.now(),
        reason,
      }, { cwd: workspacePath })
      recordHookObservation(this.config, 'SessionEnd', result)
    }
    catch (error) {
      getAgentLogger(this.config).warn('SessionEnd hook 执行失败，已忽略', error)
    }
  }

  private async resolveWorkspacePath(conversationId: string): Promise<string> {
    try {
      const conversation = await this.config.sessionStore?.getConversation(conversationId)
      if (conversation?.workspacePath)
        return conversation.workspacePath
    }
    catch (error) {
      getAgentLogger(this.config).warn('解析会话工作区失败，SessionEnd hook 使用进程工作目录', error)
    }
    return process.cwd()
  }

  private async getPromptMemorySnapshot(conversationId: string): Promise<{ memory?: string, soul?: string, user?: string } | undefined> {
    if (!this.promptMemorySnapshots.has(conversationId)) {
      try {
        this.promptMemorySnapshots.set(conversationId, await readPromptMemory(this.config))
      }
      catch (error) {
        getAgentLogger(this.config).warn('读取 prompt memory 快照失败，以空记忆继续', error)
        this.promptMemorySnapshots.set(conversationId, undefined)
      }
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

/** hook 注入的上下文记入 trace，便于排查"模型为什么看到了这段文本"。 */
function buildPreTurnContextEvents(
  compactionEvent: unknown | undefined,
  sessionStartContext: string | undefined,
  userPromptContext: string | undefined,
): unknown[] | undefined {
  const events: unknown[] = []
  if (compactionEvent)
    events.push(compactionEvent)
  if (sessionStartContext)
    events.push({ kind: 'hook', hook_event_name: 'SessionStart', additional_context: sessionStartContext })
  if (userPromptContext)
    events.push({ kind: 'hook', hook_event_name: 'UserPromptSubmit', additional_context: userPromptContext })
  return events.length > 0 ? events : undefined
}
