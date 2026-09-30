import type {
  AgentTurnQueuedResult,
  AgentTurnResult,
  AIProviderFactory,
  IConversations,
  ILogger,
  IMessage,
  StartAgentTurnOptions,
} from '@ant-chat/shared'
import type { AgentRuntime } from '../agent-core'
import type { ConversationCreation, ConversationLifecycle } from '../conversations/conversationLifecycle'
import type { AppDataContext } from '../data'
import type { ConversationTitleGenerator } from './conversationTitleGenerator'
import type { PendingMessageService } from './pendingMessageService'
import { createProvider } from '../agent-core/ai-providers/factory'
import { truncateText } from '../agent-core/utils'
import { extractMessageText } from '../agent-core/utils/messageContent'

const DEFAULT_TITLE = 'Untitled'
const MAX_TITLE_LENGTH = 30

export interface AgentTurnServiceDeps {
  runtime: AgentRuntime
  appDataContext: AppDataContext
  conversationLifecycle: ConversationLifecycle
  pendingMessages: PendingMessageService
  aiProviderFactory?: AIProviderFactory
  titleGenerator?: ConversationTitleGenerator
  emitMessageUpdated?: (message: IMessage) => void
  logger?: ILogger
}

export interface AgentTurnService {
  /**
   * 提交一轮用户消息：会话空闲时直接启动任务；已有活跃任务时自动进入
   * 待处理队列（返回 queued），等任务终态后由后端接力发出。
   */
  startTurn: (options: StartAgentTurnOptions) => Promise<AgentTurnResult>
  /**
   * 任务终态接力：会话没有活跃任务且队列非空时，把队首消息作为新一轮直接发出；
   * 启动失败（模型不可用等）时保留队列项，等待后续任务终态或用户手动处理。
   */
  relayPendingMessages: (conversationId: string) => Promise<void>
}

export function createAgentTurnService(deps: AgentTurnServiceDeps): AgentTurnService {
  const { runtime, appDataContext, conversationLifecycle, pendingMessages, aiProviderFactory, titleGenerator, emitMessageUpdated, logger } = deps

  /**
   * 落库本轮 user message：频道来源附加 origin 字段，供消息溯源与回执关联。
   */
  async function createUserMessage(options: StartAgentTurnOptions, conversationId: string): Promise<IMessage> {
    return await appDataContext.messageRepository.create({
      convId: conversationId,
      role: 'user',
      status: 'success',
      content: options.messageContent,
      turnId: undefined,
      ...(options.turnSource?.type === 'channel'
        ? {
            originType: options.turnSource.channelType,
            originChannelAccountId: options.turnSource.channelAccountId,
            originExternalChatId: options.turnSource.externalChatId,
          }
        : {}),
    })
  }

  async function startTurnImmediately(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
    const userText = extractMessageText(options.messageContent)
    if (!userText) {
      throw new Error('invalid start turn options: missing message text')
    }

    const workspacePath = options.workspacePath
    if (!workspacePath) {
      throw new Error('workspacePath is required')
    }

    const resolved = await appDataContext.modelCatalog.resolveModel({
      providerId: options.modelConfig.providerId,
      modelId: options.modelConfig.modelId,
    })
    if (!resolved) {
      throw new Error(`Model not found: ${options.modelConfig.providerId}/${options.modelConfig.modelId}`)
    }

    const { model, provider } = resolved

    const aiProvider = aiProviderFactory
      ? await aiProviderFactory({ model, provider })
      : await createProvider(provider)

    let creation: ConversationCreation | undefined
    let conversation: IConversations
    let created: boolean
    if (options.conversationId) {
      conversation = await conversationLifecycle.get(options.conversationId)
      created = false
    }
    else {
      creation = await conversationLifecycle.beginCreate({
        title: DEFAULT_TITLE,
        conversationInstructions: options.conversationInstructions ?? '',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workspacePath,
        settings: {
          modelId: options.modelConfig.modelId,
          providerId: options.modelConfig.providerId,
          reasoningEffort: options.modelConfig.reasoningEffort,
        },
      })
      conversation = creation.conversation
      created = true
    }
    if (conversation.archived) {
      throw new Error('会话已归档，请先取消归档')
    }
    const reasoningEffort = created
      ? options.modelConfig.reasoningEffort
      : conversation.settings.reasoningEffort
    let userMessage: IMessage | undefined
    try {
      userMessage = options.userMessageId
        ? await appDataContext.messageRepository.getById(options.userMessageId)
        : await createUserMessage(options, conversation.id)
      const result = await runtime.startSessionTask({
        messageContent: options.messageContent,
        conversationId: conversation.id,
        userMessageId: userMessage.id,
        model,
        provider,
        workspacePath,
        aiProvider,
        mode: options.mode ?? 'hybrid',
        turnSource: options.turnSource,
        modelSettings: {
          reasoningEffort,
        },
      })

      creation?.commit()
      emitMessageUpdated?.(userMessage)

      scheduleTitleInitialization({
        conversationId: result.conversationId,
        fallbackModelId: options.modelConfig.modelId,
        fallbackProviderId: options.modelConfig.providerId,
        appDataContext,
        conversationLifecycle,
        shouldInitializeTitle: created || conversation.title === DEFAULT_TITLE,
        titleGenerator,
        userPrompt: userText,
        logger,
      })

      return { kind: 'started', ...result }
    }
    catch (error) {
      await rollbackStartedTurn({
        appDataContext,
        creation,
        userMessageId: userMessage?.id,
        preserveUserMessage: options.turnSource?.type === 'channel',
        logger,
      })
      throw error
    }
  }

  /**
   * 运行中的排队分支。
   *
   * 频道入站消息在排队时即持久化 user message（已收到的消息不丢，接力时复用）；
   * 交互式消息只进入队列，接力时才创建 user message。
   */
  async function enqueuePendingTurn(options: StartAgentTurnOptions, conversationId: string): Promise<AgentTurnQueuedResult> {
    const userText = extractMessageText(options.messageContent)
    if (!userText) {
      throw new Error('invalid start turn options: missing message text')
    }

    const conversation = await conversationLifecycle.get(conversationId)
    if (conversation.archived) {
      throw new Error('会话已归档，请先取消归档')
    }

    let userMessage: IMessage | undefined
    if (options.userMessageId) {
      userMessage = await appDataContext.messageRepository.getById(options.userMessageId)
    }
    else if (options.turnSource?.type === 'channel') {
      userMessage = await createUserMessage(options, conversationId)
      emitMessageUpdated?.(userMessage)
    }

    const snapshot = await pendingMessages.enqueue({
      conversationId,
      text: userText,
      source: options.turnSource?.type === 'channel' ? 'channel' : 'sender',
      mode: options.mode ?? 'hybrid',
      ...(userMessage ? { userMessageId: userMessage.id } : {}),
      ...(options.turnSource ? { turnSource: options.turnSource } : {}),
    })

    return {
      kind: 'queued',
      conversationId,
      snapshot,
      ...(userMessage ? { userMessageId: userMessage.id } : {}),
    }
  }

  return {
    async startTurn(options) {
      if (options.conversationId && runtime.listActiveTasks(options.conversationId).length > 0) {
        return await enqueuePendingTurn(options, options.conversationId)
      }
      return await startTurnImmediately(options)
    },
    async relayPendingMessages(conversationId) {
      // 并发防御：接力启动前再次确认没有活跃任务（用户可能已抢先发起新一轮）。
      if (!conversationId || runtime.listActiveTasks(conversationId).length > 0)
        return
      const [record] = await pendingMessages.listRecords(conversationId)
      if (!record)
        return

      let conversation: IConversations
      try {
        conversation = await conversationLifecycle.get(conversationId)
      }
      catch (error) {
        logger?.warn('待处理消息接力失败：会话不可用，保留队列项', { conversationId, pendingMessageId: record.id, error })
        return
      }
      if (conversation.archived || !conversation.workspacePath)
        return

      try {
        await startTurnImmediately({
          conversationId,
          messageContent: [{ type: 'text', text: record.text }],
          workspacePath: conversation.workspacePath,
          mode: record.mode ?? 'hybrid',
          modelConfig: {
            modelId: conversation.settings.modelId,
            providerId: conversation.settings.providerId,
            reasoningEffort: conversation.settings.reasoningEffort,
          },
          ...(record.userMessageId ? { userMessageId: record.userMessageId } : {}),
          ...(record.turnSource ? { turnSource: record.turnSource } : {}),
        })
      }
      catch (error) {
        // 启动失败（如模型不可用）时保留队列项；下一次任务终态或用户操作时再处理。
        logger?.warn('待处理消息接力失败，保留队列项等待后续处理', { conversationId, pendingMessageId: record.id, error })
        return
      }

      await pendingMessages.remove(conversationId, record.id).catch((error) => {
        logger?.warn('接力成功后清理队列项失败', { conversationId, pendingMessageId: record.id, error })
      })
    },
  }
}

function scheduleTitleInitialization(params: {
  conversationId: string
  fallbackModelId: string
  fallbackProviderId: string
  appDataContext: AppDataContext
  conversationLifecycle: ConversationLifecycle
  shouldInitializeTitle: boolean
  titleGenerator?: ConversationTitleGenerator
  userPrompt: string
  logger?: ILogger
}) {
  const {
    conversationId,
    fallbackModelId,
    fallbackProviderId,
    appDataContext,
    conversationLifecycle,
    shouldInitializeTitle,
    titleGenerator,
    userPrompt,
    logger,
  } = params
  if (!shouldInitializeTitle) {
    return
  }

  void (async () => {
    try {
      // 读取设置决定使用 AI 生成还是截取，读取失败时默认走 AI 生成
      let autoGenerateTitle = true
      let assistantModelId = ''
      let assistantProviderId = ''
      try {
        const settings = await appDataContext.settingsRepository.getGeneralSettings()
        autoGenerateTitle = settings.autoGenerateTitle
        assistantModelId = settings.assistantModelId
        assistantProviderId = settings.assistantProviderId
      }
      catch (error) {
        logger?.warn('读取标题生成设置失败，默认使用 AI 生成', error)
      }

      if (autoGenerateTitle && titleGenerator) {
        // AI 生成标题：优先使用助手模型，未配置则回退到对话模型
        const modelRef = (assistantModelId && assistantProviderId)
          ? { providerId: assistantProviderId, modelId: assistantModelId }
          : { providerId: fallbackProviderId, modelId: fallbackModelId }
        await titleGenerator.updateTitle(conversationId, modelRef)
      }
      else if (userPrompt) {
        // 截取用户首条消息作为标题
        const truncated = truncateText(userPrompt, MAX_TITLE_LENGTH)
        await conversationLifecycle.update({ id: conversationId, title: truncated })
      }
    }
    catch (error) {
      logger?.warn('初始化会话标题失败', error)
    }
  })()
}

async function rollbackStartedTurn(params: {
  appDataContext: AppDataContext
  creation?: ConversationCreation
  userMessageId?: string
  preserveUserMessage?: boolean
  logger?: ILogger
}) {
  const { appDataContext, creation, userMessageId, preserveUserMessage, logger } = params
  try {
    if (creation) {
      await creation.rollback()
      return
    }

    if (userMessageId && preserveUserMessage) {
      // 频道入站先完成持久化，启动失败必须保留 user Message 供同一 external event 重试。
      return
    }
    if (userMessageId) {
      await appDataContext.messageRepository.delete(userMessageId)
    }
  }
  catch (rollbackError) {
    logger?.warn('回滚发送会话失败', rollbackError)
  }
}
