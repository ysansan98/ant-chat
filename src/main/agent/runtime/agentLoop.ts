import type { AgentTaskSnapshot, McpToolCall } from '@ant-chat/shared'
import type { CompactionSettings } from './compaction'
import type { LoopMessage } from './loopContext'
import type { ToolCallContext } from './toolExecution'
import type { RuntimeStartInput } from './types'
import { randomUUID } from 'node:crypto'
import { createProvider } from '@main/ai-providers/factory'
import { addMessage, getConversationById, getMessagesByConvId, getModelById, getProviderServiceById, updateConversation } from '@main/db/services'
import { isDev } from '@main/utils/env'
import { logger } from '@main/utils/logger'
import { ToolRegistry } from '../tools/toolRegistry'
import { appendAgentLog } from './agentLogger'
import { createTaskAssistantMessage, finalizeTaskAssistantMessage, updateTaskAssistantMessage } from './agentMessageWriter'
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
import { reportTaskState } from './progressReporter'
import { taskStore } from './taskStore'
import { executeToolStep } from './toolExecution'

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

export async function runAgentLoop(taskId: string, options: RuntimeStartInput) {
  const task = taskStore.get(taskId)
  if (!task)
    return

  const model = options.modelConfig?.modelId ? await getModelById(options.modelConfig.modelId) : null
  const provider = model ? getProviderServiceById(model.serviceProviderId) : null
  const aiProvider = provider && model ? await createProvider(provider) : null
  const registry = await ToolRegistry.create(task.snapshot.workspacePath, task.snapshot.mode)
  const tools = registry.listTools()
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

  try {
    const conversation = await getConversationById(options.conversationId)
    const lastCompactedAt = conversation?.settings?.lastCompactedAt
    const lastCompactionSummary = conversation?.settings?.lastCompactionSummary
    const historyMessages = await getMessagesByConvId(options.conversationId)
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

      // 上下文压缩检查：每轮调用模型前检测是否需要压缩
      if (compactionSettings.enabled && provider && step > 1) {
        const estimatedTokens = estimateContextTokens(loopMessages)
        const contextWindow = getContextWindow(provider.apiMode || 'openai')
        const usagePercent = Math.round(estimatedTokens / contextWindow * 100)
        task.snapshot.contextUsage = { estimatedTokens, contextWindow, usagePercent }

        const compResult = await compactMessages({
          messages: loopMessages,
          settings: compactionSettings,
          aiProvider,
          model: model.model,
          providerFormat: provider.apiMode || 'openai',
          abortSignal: task.abortController.signal,
        })
        if (compResult.compacted) {
          loopMessages = compResult.messages
          compactionCount++

          task.snapshot.lastCompactionAt = Date.now()

          // 持久化摘要到 conversation settings + 存标记消息用于列表分隔线
          try {
            const compactedAt = Date.now()
            const summary = compResult.summaryText || ''

            // 消息列表中的压缩标记（UI 渲染为分隔线）
            await addMessage({
              convId: options.conversationId,
              role: 'user',
              status: 'success',
              content: [{ type: 'text' as const, text: `__COMPACTION__\n${summary}` }],
              images: [],
              attachments: [],
            })

            const currentConversation = await getConversationById(options.conversationId)
            if (currentConversation) {
              await updateConversation({
                id: options.conversationId,
                settings: {
                  ...currentConversation.settings,
                  lastCompactedAt: compactedAt,
                  lastCompactionSummary: summary,
                },
              })
            }
          }
          catch (err) {
            logger.error('[agent-loop] failed to persist compaction', err)
          }

          reportTaskState(task.snapshot)

          await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'context_compacted', {
            step,
            compactionCount,
            summaryLength: compResult.summaryLength,
            keptLength: compResult.keptLength,
            totalMessages: loopMessages.length,
          })
        }
      }

      currentAssistantMessage = await createTaskAssistantMessage(
        options.conversationId,
        provider?.name ?? 'agent-runtime',
        provider?.id ?? 'agent-runtime',
        model?.name ?? 'agent-runtime',
      )
      const assistantMessageId = currentAssistantMessage.id
      currentToolMessages = []

      if (isDev) {
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
            tools: tools.map(item => ({ name: item.name, description: item.description, inputSchema: item.inputSchema })),
          },
        })
      }

      const stream = aiProvider.streamModel({
        messages: loopMessages as any,
        chatSettings: {
          model: model.model,
          temperature: options.modelConfig?.temperature,
          maxTokens: options.modelConfig?.maxTokens,
          systemPrompt: loopSystemPrompt,
        },
        tools: tools.map(item => ({ ...item, serverName: 'native' })),
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
        await updateTaskAssistantMessage(assistantMessageId, {
          status: 'loading',
          content: [{ type: 'text', text: modelText.trim() || '正在处理中…' }],
          reasoningContent: reasoningText,
          usage: latestUsage,
        })
      }

      for await (const chunk of stream) {
        const content = chunk.content || []
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

          await updateTaskAssistantMessage(currentAssistantMessage.id, {
            status: 'success',
            content: [{ type: 'text', text: currentModelText || '正在处理中…' }],
            reasoningContent: reasoningText,
            usage: latestUsage,
          })
          continue
        }
        finalAnswer = currentModelText || '任务已完成。'
        loopMessages.push({ role: 'assistant', content: [{ type: 'text', text: modelText }] })

        await finalizeTaskAssistantMessage(currentAssistantMessage.id, finalAnswer, 'success', {
          reasoningContent: reasoningText,
          usage: latestUsage,
        })
        break
      }

      const toolStepResult = requestedToolCall.invalidArgsError
        ? await createInvalidToolArgsResult({
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
            onToolCallContext: (context) => {
              lastToolCallContext = context
            },
          })
      lastToolCallContext = toolStepResult.lastToolCallContext

      // Push assistant message with tool-call content block
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

      // Push tool result message
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
    reportTaskState(task.snapshot)
    await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'task_completed', { finalAnswer })
  }
  catch (error) {
    await handleLoopFailure({
      task,
      error: error as Error,
      currentAssistantMessage,
      lastToolCallContext,
    })
  }
  finally {
    task.snapshot.updatedAt = Date.now()
    if (['success', 'failed', 'cancelled'].includes(task.snapshot.status)) {
      taskStore.finish(task.snapshot.taskId)
    }
  }
}

async function createInvalidToolArgsResult(options: {
  requestedToolCall: { toolName: string, input: Record<string, unknown>, invalidArgsError?: string }
  currentAssistantMessageId: string
  currentModelText: string
  currentToolMessages: McpToolCall[]
}): Promise<{
  lastToolCallContext: ToolCallContext
  toolCallId: string
  toolResultContent: string
  isError: boolean
}> {
  const { requestedToolCall, currentAssistantMessageId, currentModelText, currentToolMessages } = options
  const toolCallId = randomUUID()
  const error = `工具 ${requestedToolCall.toolName} 参数解析失败：${requestedToolCall.invalidArgsError || 'args must be a JSON object'}。请修正参数后重新调用该工具。`
  currentToolMessages.push({
    id: toolCallId,
    serverName: 'native',
    toolName: requestedToolCall.toolName,
    args: requestedToolCall.input,
    executeState: 'completed',
    result: {
      success: false,
      error,
    },
  })
  await updateTaskAssistantMessage(currentAssistantMessageId, {
    status: 'success',
    content: [{ type: 'text', text: currentModelText || '工具参数解析失败，等待模型修正。' }],
    toolCalls: currentToolMessages,
  })
  return {
    lastToolCallContext: {
      toolName: requestedToolCall.toolName,
      input: requestedToolCall.input,
      operationType: 'unknown',
      scope: 'unknown',
      policy: 'error',
    },
    toolCallId,
    toolResultContent: error,
    isError: true,
  }
}

async function handleLoopFailure(options: {
  task: NonNullable<ReturnType<typeof taskStore.get>>
  error: Error
  currentAssistantMessage: { id: string } | null
  lastToolCallContext: ToolCallContext | null
}) {
  const { task, error, currentAssistantMessage, lastToolCallContext } = options
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
      await finalizeTaskAssistantMessage(currentAssistantMessage.id, '任务已取消', 'cancel', {
        usage: undefined,
      })
    }
  }
  else {
    task.snapshot.status = 'failed'
    task.snapshot.errorCode = code as AgentTaskSnapshot['errorCode']
    task.snapshot.errorMessage = error.message
    if (currentAssistantMessage) {
      await finalizeTaskAssistantMessage(currentAssistantMessage.id, `任务失败：${error.message}`, 'error', {
        usage: undefined,
      })
    }
  }
  reportTaskState(task.snapshot)
  await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'task_failed', failurePayload)
  logger.error('[agent-runtime] task_failed', failurePayload)
}
