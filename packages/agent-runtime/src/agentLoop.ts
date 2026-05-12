import type { AgentRuntimeConfig, AgentTaskSnapshot, IMessage, LoopMessage, McpToolCall } from '@ant-chat/shared'
import type { ApprovalDecision } from './approvalController'
import type { CompactionSettings } from './compaction'
import type { ToolCallContext } from './toolExecution'
import type { RuntimeStartInput } from './types'
import { createCheckpointStore } from './checkpointStore'
import {
  compactMessages,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  getContextWindow,
} from './compaction'
import {
  buildConversationContextMessages,
  createLoopSystemPrompt,
  looksLikePlanOnlyResponse,
  normalizeToolArgs,
} from './loopContext'
import { taskStore } from './taskStore'
import { createInvalidToolArgsResult, executeToolStep } from './toolExecution'
import { ToolRegistry } from './toolRegistry'

const STREAM_MESSAGE_UPDATE_INTERVAL_MS = 80

function normalizeUsage(usage?: {
  inputTokens?: number
  outputTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}) {
  if (!usage) {
    return undefined
  }

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: usage.totalTokens,
    reasoningTokens: usage.reasoningTokens,
    cachedInputTokens: usage.cachedInputTokens,
  }
}

export async function runAgentLoop(input: {
  taskId: string
  options: RuntimeStartInput
  config: AgentRuntimeConfig
  appendAgentLog: (conversationId: string, userMessageId: string, event: string, payload: Record<string, unknown>) => Promise<string>
  approvalController: { waitForApproval: (task: NonNullable<ReturnType<typeof taskStore.get>>) => Promise<ApprovalDecision> }
}) {
  const { taskId, options, config, appendAgentLog, approvalController } = input
  const task = taskStore.get(taskId)
  if (!task)
    throw new Error('AGENT_TASK_NOT_FOUND')

  const model = options.modelConfig?.modelId ? await config.modelResolver.getModelById(options.modelConfig.modelId) : null
  const provider = model ? config.modelResolver.getProviderById(model.serviceProviderId).then(p => p!) : null
  const resolvedProvider = await provider
  const aiProvider = model ? await config.aiProviderFactory(options.modelConfig!.modelId, config.modelResolver) : null
  const tools = await config.toolProvider(task.snapshot.workspacePath, task.snapshot.mode)
  const registry = new ToolRegistry(tools)
  const toolDefs = registry.listTools()
  const loopSystemPrompt = createLoopSystemPrompt(task.snapshot.workspacePath)

  const compactionSettings: CompactionSettings = {
    ...DEFAULT_COMPACTION_SETTINGS,
    ...(options.compaction
      ? {
          enabled: options.compaction.enabled,
          thresholdPercent: options.compaction.thresholdPercent,
          keepRecentPairs: options.compaction.keepRecentPairs,
        }
      : {}),
  }
  let compactionCount = 0

  let step = 0
  let finalAnswer = ''
  let currentAssistantMessage: { id: string } | null = null
  let currentToolMessages: McpToolCall[] = []
  let currentModelText = ''
  let lastToolCallContext: ToolCallContext | null = null
  let loopMessages: LoopMessage[] = []

  const { writeCheckpoint, removeCheckpoint } = createCheckpointStore(config.pathProvider)

  try {
    const conversation = await config.messageStore.getConversationById(options.conversationId)
    const lastCompactedAt = conversation?.settings?.lastCompactedAt as number | undefined
    const lastCompactionSummary = conversation?.settings?.lastCompactionSummary as string | undefined
    const historyMessages: IMessage[] = await config.messageStore.getMessagesByConvId(options.conversationId)
    const contextMessages = buildConversationContextMessages(historyMessages, options.userMessageId, lastCompactedAt, lastCompactionSummary)
    loopMessages.push(...contextMessages)
    loopMessages.push({
      role: 'user',
      content: [{ type: 'text', text: options.prompt }],
    })

    for (;;) {
      if (task.abortController.signal.aborted)
        throw new Error('AGENT_CANCELLED')
      step += 1

      if (!aiProvider || !model) {
        throw new Error('AGENT_TOOL_EXEC_FAILED')
      }

      if (compactionSettings.enabled && resolvedProvider && step > 1) {
        const estimatedTokens = estimateContextTokens(loopMessages)
        const contextWindow = getContextWindow(resolvedProvider.apiMode || 'openai')
        const usagePercent = Math.round(estimatedTokens / contextWindow * 100)
        task.snapshot.contextUsage = { estimatedTokens, contextWindow, usagePercent }

        const compResult = await compactMessages({
          messages: loopMessages,
          settings: compactionSettings,
          aiProvider,
          model: model.model,
          providerFormat: resolvedProvider.apiMode || 'openai',
          abortSignal: task.abortController.signal,
          logger: config.logger,
        })
        if (compResult.compacted) {
          loopMessages = compResult.messages
          compactionCount++

          task.snapshot.lastCompactionAt = Date.now()

          try {
            const compactedAt = Date.now()
            const summary = compResult.summaryText || ''

            await config.messageStore.addMessage({
              convId: options.conversationId,
              role: 'user',
              status: 'success',
              content: [{ type: 'text' as const, text: `__COMPACTION__\n${summary}` }],
            })

            const currentConversation = await config.messageStore.getConversationById(options.conversationId)
            if (currentConversation) {
              await config.messageStore.updateConversation(options.conversationId, {
                settings: {
                  ...currentConversation.settings,
                  lastCompactedAt: compactedAt,
                  lastCompactionSummary: summary,
                },
              })
            }
          }
          catch (err) {
            config.logger.error('[agent-loop] failed to persist compaction', err)
          }

          config.eventEmitter.emitTaskUpdated(task.snapshot)

          await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'context_compacted', {
            step,
            compactionCount,
            summaryLength: compResult.summaryLength,
            keptLength: compResult.keptLength,
            totalMessages: loopMessages.length,
          })
        }
      }

      currentAssistantMessage = await config.messageStore.createAssistantMessage(
        options.conversationId,
        resolvedProvider?.name ?? 'agent-runtime',
        resolvedProvider?.id ?? 'agent-runtime',
        model?.name ?? 'agent-runtime',
      )
      const assistantMessageId = currentAssistantMessage.id
      currentToolMessages = []

      if (config.isDev) {
        await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'model_request_started', {
          step,
          workspacePath: task.snapshot.workspacePath,
          requestBody: {
            messages: loopMessages,
            chatSettings: {
              model: model.model,
              temperature: options.modelConfig?.temperature,
              maxTokens: options.modelConfig?.maxTokens,
              systemPrompt: loopSystemPrompt,
            },
            tools: toolDefs.map(item => ({ name: item.name, description: item.description, inputSchema: item.inputSchema })),
          },
        })
      }

      const stream = aiProvider.streamModel({
        messages: loopMessages,
        chatSettings: {
          model: model.model,
          temperature: options.modelConfig?.temperature,
          maxTokens: options.modelConfig?.maxTokens,
          systemPrompt: loopSystemPrompt,
        },
        tools: toolDefs.map(item => ({ ...item, serverName: 'native' })),
        abortSignal: task.abortController.signal,
      })

      let modelText = ''
      let reasoningText = ''
      let latestUsage: ReturnType<typeof normalizeUsage>
      let requestedToolCall: { toolName: string, input: Record<string, unknown>, invalidArgsError?: string } | null = null
      let lastStreamUpdateAt = 0
      const flushStreamMessage = async (force = false) => {
        const now = Date.now()
        if (!force && now - lastStreamUpdateAt < STREAM_MESSAGE_UPDATE_INTERVAL_MS) {
          return
        }
        if (!modelText && !reasoningText) {
          return
        }
        lastStreamUpdateAt = now
        await config.messageStore.updateMessage(assistantMessageId, {
          status: 'loading',
          content: [{ type: 'text', text: modelText.trim() || '正在处理中…' }],
          reasoningContent: reasoningText,
          usage: latestUsage,
        })
      }

      for await (const chunk of stream) {
        const content = (chunk as any).content || []
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            modelText += item.text
          }
        }
        if ((chunk as any).reasoningContent) {
          reasoningText += (chunk as any).reasoningContent
        }
        const functionCalls = (chunk as any).functionCalls || []
        if (functionCalls.length > 0) {
          const fc = functionCalls[0]
          const argsResult = normalizeToolArgs(fc.args)
          requestedToolCall = {
            toolName: fc.toolName,
            input: argsResult.ok ? argsResult.input : {},
            invalidArgsError: argsResult.ok ? undefined : argsResult.error,
          }
        }
        if ((chunk as any).usage) {
          latestUsage = normalizeUsage((chunk as any).usage)
        }
        await flushStreamMessage()
      }
      await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'model_response_finished', {
        step,
        textPreview: modelText.slice(0, 500),
        hasToolCall: Boolean(requestedToolCall),
        usage: latestUsage,
      })
      currentModelText = modelText.trim()
      await flushStreamMessage(true)

      if (!requestedToolCall) {
        if (looksLikePlanOnlyResponse(currentModelText)) {
          const nudge = '不要只给计划。请立即调用一个最合适的工具，或在信息已足够时直接给出最终答案。'
          loopMessages.push({ role: 'assistant', content: [{ type: 'text', text: modelText }] })
          loopMessages.push({ role: 'user', content: [{ type: 'text', text: nudge }] })

          await config.messageStore.updateMessage(currentAssistantMessage.id, {
            status: 'success',
            content: [{ type: 'text', text: currentModelText || '正在处理中…' }],
            reasoningContent: reasoningText,
            usage: latestUsage,
          })
          continue
        }
        finalAnswer = currentModelText || '任务已完成。'
        loopMessages.push({ role: 'assistant', content: [{ type: 'text', text: modelText }] })

        await finalizeAssistantMessage(config, currentAssistantMessage.id, finalAnswer, 'success', {
          reasoningContent: reasoningText,
          usage: latestUsage,
        })
        break
      }

      const toolStepResult = requestedToolCall.invalidArgsError
        ? await createInvalidToolArgsResult({
            config,
            requestedToolCall,
            currentAssistantMessageId: currentAssistantMessage.id,
            currentModelText,
            currentToolMessages,
          })
        : await executeToolStep({
            task,
            registry,
            requestedToolCall,
            currentAssistantMessageId: currentAssistantMessage.id,
            currentModelText,
            currentToolMessages,
            step,
            config,
            appendAgentLog,
            waitForApproval: approvalController.waitForApproval,
            onToolCallContext: (context) => {
              lastToolCallContext = context
            },
          })
      lastToolCallContext = toolStepResult.lastToolCallContext

      const assistantContent: LoopMessage['content'] = []
      if (modelText.trim()) {
        assistantContent.push({ type: 'text', text: modelText })
      }
      assistantContent.push({
        type: 'tool-call',
        toolCallId: toolStepResult.toolCallId,
        toolName: requestedToolCall.toolName,
        args: requestedToolCall.input,
      })
      loopMessages.push({ role: 'assistant', content: assistantContent })

      loopMessages.push({
        role: 'tool',
        content: [{
          type: 'tool-result',
          toolCallId: toolStepResult.toolCallId,
          toolName: requestedToolCall.toolName,
          result: toolStepResult.toolResultContent,
          isError: toolStepResult.isError,
        }],
      })
    }

    task.snapshot.status = 'success'
    config.eventEmitter.emitTaskUpdated(task.snapshot)
    await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'task_completed', { finalAnswer })
  }
  catch (error) {
    await handleLoopFailure({
      config,
      task,
      error: error as Error,
      currentAssistantMessage,
      lastToolCallContext,
      appendAgentLog,
    })
  }
  finally {
    task.snapshot.updatedAt = Date.now()
    task.snapshot.checkpointPath = await writeCheckpoint(task.snapshot)
    if (['success', 'failed', 'cancelled'].includes(task.snapshot.status)) {
      await removeCheckpoint(task.snapshot.taskId)
      taskStore.finish(task.snapshot.taskId)
    }
  }
}

async function finalizeAssistantMessage(
  config: AgentRuntimeConfig,
  messageId: string,
  text: string,
  status: 'success' | 'error' | 'cancel',
  patch?: { reasoningContent?: string, usage?: ReturnType<typeof normalizeUsage> },
) {
  return config.messageStore.updateMessage(messageId, {
    ...patch,
    status,
    content: status === 'error'
      ? [{ type: 'error', error: text }]
      : [{ type: 'text', text }],
  })
}

async function handleLoopFailure(options: {
  config: AgentRuntimeConfig
  task: NonNullable<ReturnType<typeof taskStore.get>>
  error: Error
  currentAssistantMessage: { id: string } | null
  lastToolCallContext: ToolCallContext | null
  appendAgentLog: (conversationId: string, userMessageId: string, event: string, payload: Record<string, unknown>) => Promise<string>
}) {
  const { config, task, error, currentAssistantMessage, lastToolCallContext, appendAgentLog } = options
  const code = error.message
  const failurePayload = {
    error: error.message,
    stack: error.stack || '',
    workspacePath: task.snapshot.workspacePath,
    lastToolCallContext,
  }
  if (code === 'AGENT_CANCELLED') {
    task.snapshot.status = 'cancelled'
    if (currentAssistantMessage) {
      await finalizeAssistantMessage(config, currentAssistantMessage.id, '任务已取消', 'cancel', {
        usage: undefined,
      })
    }
  }
  else {
    task.snapshot.status = 'failed'
    task.snapshot.errorCode = code as AgentTaskSnapshot['errorCode']
    task.snapshot.errorMessage = error.message
    if (currentAssistantMessage) {
      await finalizeAssistantMessage(config, currentAssistantMessage.id, `任务失败：${error.message}`, 'error', {
        usage: undefined,
      })
    }
  }
  config.eventEmitter.emitTaskUpdated(task.snapshot)
  await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'task_failed', failurePayload)
  config.logger.error('[agent-runtime] task_failed', failurePayload)
}
