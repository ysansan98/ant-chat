import type {
  AgentRuntimeStartTaskResult,
  AIProviderFactory,
  ILogger,
  IMessage,
  StartAgentTurnOptions,
} from '@ant-chat/shared'
import type { AgentRuntime } from '../agent-core'
import type { ConversationCreation, ConversationLifecycle } from '../conversations/conversationLifecycle'
import type { AppDataContext } from '../data'
import type { ConversationTitleGenerator } from './conversationTitleGenerator'
import { createProvider } from '../agent-core/ai-providers/factory'
import { truncateText } from '../agent-core/utils'
import { extractMessageText } from '../agent-core/utils/messageContent'

const DEFAULT_TITLE = 'Untitled'
const MAX_TITLE_LENGTH = 30

export interface AgentTurnServiceDeps {
  runtime: AgentRuntime
  appDataContext: AppDataContext
  conversationLifecycle: ConversationLifecycle
  aiProviderFactory?: AIProviderFactory
  titleGenerator?: ConversationTitleGenerator
  emitMessageUpdated?: (message: IMessage) => void
  logger?: ILogger
}

export interface AgentTurnService {
  startTurn: (options: StartAgentTurnOptions) => Promise<AgentRuntimeStartTaskResult>
}

export function createAgentTurnService(deps: AgentTurnServiceDeps): AgentTurnService {
  const { runtime, appDataContext, conversationLifecycle, aiProviderFactory, titleGenerator, emitMessageUpdated, logger } = deps

  return {
    async startTurn(options) {
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
      let conversation: AgentRuntimeStartTaskResult['conversation']
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
            temperature: options.modelConfig.temperature ?? 0.7,
            maxOutputTokens: options.modelConfig.maxOutputTokens ?? 4096,
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
          : await appDataContext.messageRepository.create({
              convId: conversation.id,
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
            temperature: options.modelConfig.temperature,
            maxOutputTokens: options.modelConfig.maxOutputTokens,
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

        return result
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
