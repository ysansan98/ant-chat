import type {
  AgentRuntimeStartTaskResult,
  AIProviderFactory,
  ILogger,
  IMessage,
  IMessageContent,
  StartAgentTurnOptions,
} from '@ant-chat/shared'
import type { AgentRuntime } from '../agent-core'
import type { AppDataContext } from '../data'
import type { ConversationTitleGenerator } from './conversationTitleGenerator'

const DEFAULT_TITLE = 'Untitled'
const MAX_TITLE_LENGTH = 30

export interface AgentTurnServiceDeps {
  runtime: AgentRuntime
  appDataContext: AppDataContext
  aiProviderFactory?: AIProviderFactory
  titleGenerator?: ConversationTitleGenerator
  emitConversationUpdated?: (conversation: AgentRuntimeStartTaskResult['conversation']) => void
  emitMessageUpdated?: (message: IMessage) => void
  logger?: ILogger
}

export interface AgentTurnService {
  startTurn: (options: StartAgentTurnOptions) => Promise<AgentRuntimeStartTaskResult>
}

export function createAgentTurnService(deps: AgentTurnServiceDeps): AgentTurnService {
  const { runtime, appDataContext, aiProviderFactory, titleGenerator, emitConversationUpdated, emitMessageUpdated, logger } = deps

  return {
    async startTurn(options) {
      const prompt = options.prompt.trim()
      if (!prompt) {
        throw new Error('invalid start turn options: missing prompt')
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
        : undefined

      const conversationState = options.conversationId
        ? {
            conversation: await appDataContext.conversationRepository.getById(options.conversationId),
            created: false,
          }
        : {
            conversation: await appDataContext.conversationRepository.create({
              title: DEFAULT_TITLE,
              createdAt: Date.now(),
              updatedAt: Date.now(),
              workspacePath,
              settings: {
                modelId: options.modelConfig.modelId,
                providerId: options.modelConfig.providerId,
                systemPrompt: options.modelConfig.systemPrompt ?? '',
                temperature: options.modelConfig.temperature ?? 0.7,
                maxTokens: options.modelConfig.maxTokens ?? 4096,
              },
            }),
            created: true,
          }

      const { conversation } = conversationState
      if (conversation.archived) {
        throw new Error('会话已归档，请先取消归档')
      }
      if (runtime.listActiveTasks(conversation.id).length > 0) {
        throw new Error('AGENT_TASK_ALREADY_RUNNING')
      }

      const userMessage = await appDataContext.messageRepository.create({
        convId: conversation.id,
        role: 'user',
        status: 'success',
        content: resolveUserMessageContent(options.content, prompt),
        turnId: undefined,
      })

      emitMessageUpdated?.(userMessage)

      try {
        const result = await runtime.startTask({
          prompt,
          conversationId: conversation.id,
          userMessageId: userMessage.id,
          model,
          provider,
          workspacePath,
          aiProvider,
          mode: options.mode ?? 'hybrid',
          content: options.content,
          referencedFiles: options.referencedFiles,
          turnSource: options.turnSource,
          modelSettings: {
            systemPrompt: options.modelConfig.systemPrompt,
            temperature: options.modelConfig.temperature,
            maxTokens: options.modelConfig.maxTokens,
          },
        })

        scheduleTitleInitialization({
          conversationId: result.conversationId,
          fallbackModelId: options.modelConfig.modelId,
          fallbackProviderId: options.modelConfig.providerId,
          appDataContext,
          shouldInitializeTitle: conversationState.created || conversation.title === DEFAULT_TITLE,
          titleGenerator,
          userPrompt: prompt,
          emitConversationUpdated,
          logger,
        })

        return result
      }
      catch (error) {
        await rollbackStartedTurn({
          appDataContext,
          conversationId: conversation.id,
          userMessageId: userMessage.id,
          createdConversation: conversationState.created,
          logger,
        })
        throw error
      }
    },
  }
}

function resolveUserMessageContent(content: IMessageContent | undefined, prompt: string): IMessageContent {
  return content && content.length > 0
    ? content
    : [{ type: 'text', text: prompt }]
}

function scheduleTitleInitialization(params: {
  conversationId: string
  fallbackModelId: string
  fallbackProviderId: string
  appDataContext: AppDataContext
  shouldInitializeTitle: boolean
  titleGenerator?: ConversationTitleGenerator
  userPrompt: string
  emitConversationUpdated?: AgentTurnServiceDeps['emitConversationUpdated']
  logger?: ILogger
}) {
  const {
    conversationId,
    fallbackModelId,
    fallbackProviderId,
    appDataContext,
    shouldInitializeTitle,
    titleGenerator,
    userPrompt,
    emitConversationUpdated,
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
        const conversation = await titleGenerator.updateTitle(conversationId, modelRef)
        emitConversationUpdated?.(conversation)
      }
      else if (userPrompt) {
        // 截取用户首条消息作为标题
        const truncated = truncateText(userPrompt, MAX_TITLE_LENGTH)
        const conversation = await appDataContext.conversationRepository.update({ id: conversationId, title: truncated })
        emitConversationUpdated?.(conversation)
      }
    }
    catch (error) {
      logger?.warn('初始化会话标题失败', error)
    }
  })()
}

/**
 * 截取文本前 N 个字符作为标题，超出则添加省略号。
 */
function truncateText(text: string, maxLength: number): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength)}…`
}

async function rollbackStartedTurn(params: {
  appDataContext: AppDataContext
  conversationId: string
  userMessageId: string
  createdConversation: boolean
  logger?: ILogger
}) {
  const { appDataContext, conversationId, userMessageId, createdConversation, logger } = params
  try {
    if (createdConversation) {
      await appDataContext.conversationRepository.delete(conversationId)
      return
    }

    await appDataContext.messageRepository.delete(userMessageId)
  }
  catch (rollbackError) {
    logger?.warn('回滚发送会话失败', rollbackError)
  }
}
