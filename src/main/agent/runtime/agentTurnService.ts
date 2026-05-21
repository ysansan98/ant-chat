import type { AddMessage, AgentRuntimeConfig, AgentTurnResult, CompactionSettingsSchema, IAIProvider, LoopMessage, StartAgentTurnOptions } from '@ant-chat/shared'
import {
  AgentRuntime,
  buildConversationContextMessages,
  buildPromptWithTurnContext,
  compactMessages,
  createLoopSystemPrompt,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
} from '@ant-chat/runtime'
import { createDbAIProvider } from '@main/agent/adapters/aiProviderFactory.adapter'
import { createCompactionStrategy } from '@main/agent/adapters/compactionStrategy.adapter'
import { createDbConversationQuery } from '@main/agent/adapters/conversationQuery.adapter'
import { dbModelResolver } from '@main/agent/adapters/dbModelResolver.adapter'
import { createElectronEventEmitter } from '@main/agent/adapters/electronEventEmitter.adapter'
import { electronLogger } from '@main/agent/adapters/electronLogger.adapter'
import { electronToolProvider } from '@main/agent/adapters/toolProvider.adapter'
import { addConversation, addMessage, getConversationById } from '@main/db/services'
import { WorkspaceStore } from '@main/store/workspace'

const eventEmitter = createElectronEventEmitter()

function createRuntimeConfig(): AgentRuntimeConfig {
  return {
    eventEmitter,
    logger: electronLogger,
  }
}

export const agentRuntime = new AgentRuntime(createRuntimeConfig())

const DEFAULT_CONVERSATION_TITLE = 'Untitled'

export async function startAgentTurn(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
  const prompt = options.prompt.trim()
  if (!prompt) {
    throw new Error('invalid start turn options: missing prompt')
  }
  if (!options.chatSettings?.modelId?.trim()) {
    throw new Error('invalid start turn options: missing modelId')
  }

  const workspacePath = options.workspacePath
    ?? WorkspaceStore.getInstance().getCurrentWorkspacePath()
    ?? process.cwd()

  // 1. 创建或获取 conversation
  const conversation = options.conversationId
    ? await getConversationById(options.conversationId)
    : await addConversation({
        title: DEFAULT_CONVERSATION_TITLE,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        workspacePath,
        settings: {
          modelId: options.chatSettings.modelId,
          systemPrompt: options.chatSettings.systemPrompt,
          temperature: options.chatSettings.temperature,
          maxTokens: options.chatSettings.maxTokens,
        },
      })

  const activeTasks = agentRuntime.listActiveTasks(conversation.id)
  if (activeTasks.length > 0) {
    throw new Error('AGENT_TASK_ALREADY_RUNNING')
  }

  // 2. 创建用户消息
  const userMessage = await addMessage({
    convId: conversation.id,
    role: 'user',
    status: 'success',
    content: [{ type: 'text', text: prompt }],
    images: options.images ?? [],
    attachments: options.attachments ?? [],
  } satisfies AddMessage)

  // 3. 解析 model + provider
  const modelId = options.chatSettings.modelId
  const model = await dbModelResolver.getModelById(modelId)
  if (!model) {
    throw new Error(`Model not found: ${modelId}`)
  }
  const provider = await dbModelResolver.getProviderById(model.serviceProviderId)
  if (!provider) {
    throw new Error(`Provider not found for model: ${model.model}`)
  }

  // 4. 创建 AI provider
  const aiProvider = await createDbAIProvider(modelId, dbModelResolver)

  // 5. 加载历史消息 + 构建上下文
  const convQuery = createDbConversationQuery()
  const conv = await convQuery.getConversationById(conversation.id)
  const historyMessages = await convQuery.getMessagesByConvId(conversation.id)
  const contextMessages = buildConversationContextMessages(
    historyMessages,
    userMessage.id,
    conv?.settings?.lastCompactedAt,
    conv?.settings?.lastCompactionSummary,
  )

  // 6. 构建完整消息列表（上下文 + 用户prompt）
  const enrichedPrompt = buildPromptWithTurnContext({
    prompt,
    referencedFiles: options.referencedFiles,
    selectedSkill: options.selectedSkill,
  })
  const messages: LoopMessage[] = [
    ...contextMessages,
    { role: 'user', content: [{ type: 'text', text: enrichedPrompt }] },
  ]

  // 7. 准备工具
  const tools = await electronToolProvider(workspacePath, options.mode ?? 'hybrid')

  // 8. 系统提示词
  const systemPrompt = createLoopSystemPrompt(workspacePath, options.chatSettings.systemPrompt)

  const apiMode = provider.apiMode || 'openai'
  const compactionSettings: CompactionSettingsSchema = conv?.settings?.compaction ?? DEFAULT_COMPACTION_SETTINGS

  // 9. 创建 compaction gate (onBeforeTurn)
  const compactionStrategy = createCompactionStrategy()
  const onBeforeTurn = createCompactionGate({
    settings: compactionSettings,
    aiProvider,
    modelName: model.model,
    apiMode,
    summarize: compactionStrategy.summarize,
    eventEmitter,
    conversationId: conversation.id,
    userMessageId: userMessage.id,
  })

  // 10. 启动任务
  const task = await agentRuntime.startTask(
    {
      conversationId: conversation.id,
      userMessageId: userMessage.id,
      prompt: enrichedPrompt,
      workspacePath,
      mode: options.mode ?? 'hybrid',
      messages,
      systemPrompt,
      tools,
      aiProvider,
      modelName: model.model,
      providerName: provider.name,
      providerId: provider.id,
      apiMode,
      temperature: options.chatSettings.temperature,
      maxTokens: options.chatSettings.maxTokens,
      compaction: compactionSettings,
    },
    { onBeforeTurn },
  )

  return {
    ...task,
    conversationId: conversation.id,
    userMessageId: userMessage.id,
    conversation,
  }
}

// ============================================================
// Compaction Gate（Plan A: agent-loop 完全无感的压缩机制）
// ============================================================

function createCompactionGate(params: {
  settings: CompactionSettingsSchema
  aiProvider: IAIProvider | null
  modelName: string
  apiMode: string
  summarize: (serialized: string, aiProvider: IAIProvider, model: string, abortSignal?: AbortSignal) => Promise<string>
  eventEmitter: AgentRuntimeConfig['eventEmitter']
  conversationId: string
  userMessageId: string
}): (ctx: { messages: LoopMessage[], step: number }) => Promise<{ messages: LoopMessage[] }> {
  const { settings, aiProvider, modelName, apiMode, summarize, eventEmitter, conversationId, userMessageId } = params
  let compactionCount = 0

  return async (ctx) => {
    if (!settings.enabled || !aiProvider) {
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
      logger: electronLogger,
      summarize,
    })

    if (!compResult.compacted) {
      return { messages: ctx.messages }
    }

    compactionCount++

    // 持久化压缩结果
    try {
      eventEmitter.emitCompactionSaved({
        conversationId,
        summary: compResult.summaryText || '',
        compactedAt: Date.now(),
      })
    }
    catch (err) {
      electronLogger.error('[compaction-gate] failed to persist compaction', err)
    }

    electronLogger.info('[agent-runtime]', { event: 'context_compacted', conversationId, userMessageId, step: ctx.step, compactionCount, summaryLength: compResult.summaryLength, keptLength: compResult.keptLength, totalMessages: compResult.messages.length })

    return { messages: compResult.messages }
  }
}
