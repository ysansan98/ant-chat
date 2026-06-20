import type { AgentRuntime } from '@ant-chat/agent-core'
import type { AppDataContext } from '@ant-chat/app-data'
import type {
  AgentRuntimeStartTaskResult,
  AIProviderFactory,
  ILogger,
  IMessageContent,
  StartAgentTurnOptions,
} from '@ant-chat/shared'
import type { ConversationTitleGenerator } from './conversationTitleGenerator'
import process from 'node:process'

const DEFAULT_TITLE = 'Untitled'

export interface AgentTurnServiceDeps {
  runtime: AgentRuntime
  appDataContext: AppDataContext
  aiProviderFactory?: AIProviderFactory
  titleGenerator?: ConversationTitleGenerator
  emitConversationUpdated?: (conversation: AgentRuntimeStartTaskResult['conversation']) => void
  logger?: ILogger
}

export interface AgentTurnService {
  startTurn: (options: StartAgentTurnOptions) => Promise<AgentRuntimeStartTaskResult>
}

export function createAgentTurnService(deps: AgentTurnServiceDeps): AgentTurnService {
  const { runtime, appDataContext, aiProviderFactory, titleGenerator, emitConversationUpdated, logger } = deps

  return {
    async startTurn(options) {
      const prompt = options.prompt.trim()
      if (!prompt) {
        throw new Error('invalid start turn options: missing prompt')
      }

      const workspacePath = options.workspacePath
        ?? appDataContext.workspaceService.getCurrentWorkspacePath()
        ?? process.cwd()

      const model = await appDataContext.modelCatalog.getModelById(options.modelConfig.modelId)
      if (!model) {
        throw new Error(`Model not found: ${options.modelConfig.modelId}`)
      }

      const provider = await appDataContext.modelCatalog.getProviderById(model.providerId)
      if (!provider) {
        throw new Error(`Provider not found for model: ${model.model}`)
      }

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
                systemPrompt: options.modelConfig.systemPrompt ?? '',
                temperature: options.modelConfig.temperature ?? 0.7,
                maxTokens: options.modelConfig.maxTokens ?? 4096,
              },
            }),
            created: true,
          }

      const { conversation } = conversationState
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

      try {
        const result = await runtime.startTask({
          prompt,
          conversationId: conversation.id,
          userMessageId: userMessage.id,
          modelId: options.modelConfig.modelId,
          workspacePath,
          aiProvider,
          mode: options.mode ?? 'hybrid',
          content: options.content,
          referencedFiles: options.referencedFiles,
          selectedSkill: options.selectedSkill,
          modelSettings: {
            systemPrompt: options.modelConfig.systemPrompt,
            temperature: options.modelConfig.temperature,
            maxTokens: options.modelConfig.maxTokens,
          },
        })

        scheduleTitleInitialization({
          conversationId: result.conversationId,
          fallbackModelId: options.modelConfig.modelId,
          appDataContext,
          shouldInitializeTitle: conversationState.created || conversation.title === DEFAULT_TITLE,
          titleGenerator,
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
  appDataContext: AppDataContext
  shouldInitializeTitle: boolean
  titleGenerator?: ConversationTitleGenerator
  emitConversationUpdated?: AgentTurnServiceDeps['emitConversationUpdated']
  logger?: ILogger
}) {
  const {
    conversationId,
    fallbackModelId,
    appDataContext,
    shouldInitializeTitle,
    titleGenerator,
    emitConversationUpdated,
    logger,
  } = params
  if (!shouldInitializeTitle || !titleGenerator) {
    return
  }

  // 优先使用设置页面配置的助手模型生成标题，未配置或读取失败时回退到当前对话模型
  void resolveTitleModelId(appDataContext, fallbackModelId, logger)
    .then(modelId => titleGenerator.updateTitle(conversationId, modelId))
    .then((conversation) => {
      emitConversationUpdated?.(conversation)
    })
    .catch((error) => {
      logger?.warn('初始化会话标题失败', error)
    })
}

/**
 * 解析生成标题使用的模型 ID：
 * 优先返回设置页面配置的助手模型（assistantModelId），
 * 未配置或读取设置失败时回退到当前对话使用的模型。
 */
async function resolveTitleModelId(
  appDataContext: AppDataContext,
  fallbackModelId: string,
  logger?: ILogger,
): Promise<string> {
  try {
    const { assistantModelId } = await appDataContext.settingsRepository.getGeneralSettings()
    return assistantModelId || fallbackModelId
  }
  catch (error) {
    logger?.warn('读取助手模型设置失败，回退到对话模型生成标题', error)
    return fallbackModelId
  }
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
