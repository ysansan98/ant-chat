import type { AgentTaskSnapshot, McpToolCall, StartAgentTaskOptions } from '@ant-chat/shared'
import type { LoopMessage } from './loopContext'
import type { ToolCallContext } from './toolExecution'
import { createProvider } from '@main/ai-providers/factory'
import { getMessagesByConvId, getModelById, getProviderServiceById } from '@main/db/services'
import { logger } from '@main/utils/logger'
import { ToolRegistry } from '../tools/toolRegistry'
import { appendAgentLog } from './agentLogger'
import { createTaskAssistantMessage, finalizeTaskAssistantMessage, updateTaskAssistantMessage } from './agentMessageWriter'
import { removeCheckpoint, writeCheckpoint } from './checkpointStore'
import {
  buildConversationContextMessages,
  buildPlanningPrompt,
  createLoopSystemPrompt,
  createRuntimeState,
  looksLikePlanOnlyResponse,

  normalizeToolArgs,
  trimLoopMessages,
} from './loopContext'
import { reportTaskState } from './progressReporter'
import { taskStore } from './taskStore'
import { executeToolStep, markRunningProgress } from './toolExecution'

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

export async function runAgentLoop(taskId: string, options: StartAgentTaskOptions) {
  const task = taskStore.get(taskId)
  if (!task)
    return

  const model = options.chatSettings?.modelId ? await getModelById(options.chatSettings.modelId) : null
  const provider = model ? getProviderServiceById(model.serviceProviderId) : null
  const aiProvider = provider && model ? await createProvider(provider) : null
  const registry = await ToolRegistry.create(task.snapshot.workspacePath, task.snapshot.mode)
  const tools = registry.listTools()
  const loopSystemPrompt = createLoopSystemPrompt(task.snapshot.workspacePath)
  let step = 0
  const observations: string[] = []
  let finalAnswer = ''
  let currentAssistantMessage: { id: string } | null = null
  let currentToolMessages: McpToolCall[] = []
  let currentModelText = ''
  let lastToolCallContext: ToolCallContext | null = null
  const runtimeState = createRuntimeState(options.prompt)
  const loopMessages: LoopMessage[] = []

  try {
    const historyMessages = await getMessagesByConvId(options.conversationId)
    const contextMessages = buildConversationContextMessages(historyMessages, options.userMessageId)
    loopMessages.push(...contextMessages)
    loopMessages.push({
      role: 'user',
      content: [{ type: 'text', text: options.prompt }],
    })
    trimLoopMessages(loopMessages)

    for (;;) {
      if (task.abortController.signal.aborted)
        throw new Error('AGENT_CANCELLED')
      step += 1

      if (!aiProvider || !model) {
        throw new Error('AGENT_TOOL_EXEC_FAILED')
      }

      currentAssistantMessage = await createTaskAssistantMessage(
        options.conversationId,
        provider?.name ?? 'agent-runtime',
        provider?.id ?? 'agent-runtime',
        model?.name ?? 'agent-runtime',
      )
      currentToolMessages = []

      const planningPrompt = buildPlanningPrompt(options.prompt, runtimeState, observations)

      await appendAgentLog(task.snapshot.taskId, 'model_request_started', {
        step,
        workspacePath: task.snapshot.workspacePath,
        promptPreview: planningPrompt.slice(0, 500),
        observationCount: observations.length,
      })

      const stream = aiProvider.sendChatCompletions({
        messages: [...loopMessages, { role: 'user', content: [{ type: 'text', text: planningPrompt }] }] as any,
        chatSettings: {
          model: model.model,
          temperature: options.chatSettings?.temperature,
          maxTokens: options.chatSettings?.maxTokens,
          systemPrompt: loopSystemPrompt,
        },
        tools: tools.map(item => ({ ...item, serverName: 'native' })),
        abortSignal: task.abortController.signal,
      })

      let modelText = ''
      let latestUsage: ReturnType<typeof normalizeUsage>
      let requestedToolCall: { toolName: string, input: Record<string, unknown> } | null = null
      for await (const chunk of stream) {
        const content = chunk.content || []
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            modelText += item.text
          }
        }
        const functionCalls = (chunk as any).functionCalls || []
        if (functionCalls.length > 0) {
          const fc = functionCalls[0]
          requestedToolCall = {
            toolName: fc.toolName,
            input: normalizeToolArgs(fc.args),
          }
        }
        if ((chunk as any).usage) {
          latestUsage = normalizeUsage((chunk as any).usage)
        }
      }
      await appendAgentLog(task.snapshot.taskId, 'model_response_finished', {
        step,
        textPreview: modelText.slice(0, 500),
        hasToolCall: Boolean(requestedToolCall),
        usage: latestUsage,
      })
      currentModelText = modelText.trim() || '正在处理中…'
      await updateTaskAssistantMessage(currentAssistantMessage.id, {
        status: 'loading',
        content: [{ type: 'text', text: currentModelText }],
        usage: latestUsage,
      })
      loopMessages.push({ role: 'assistant', content: [{ type: 'text', text: modelText }] })
      trimLoopMessages(loopMessages)
      if (!requestedToolCall) {
        if (looksLikePlanOnlyResponse(currentModelText)) {
          const nudge = '不要只给计划。请立即调用一个最合适的工具，或在信息已足够时直接给出最终答案。'
          observations.push(nudge)
          loopMessages.push({ role: 'user', content: [{ type: 'text', text: nudge }] })
          trimLoopMessages(loopMessages)
          await updateTaskAssistantMessage(currentAssistantMessage.id, {
            status: 'success',
            content: [{ type: 'text', text: currentModelText }],
            usage: latestUsage,
          })
          continue
        }
        finalAnswer = currentModelText || '任务已完成。'
        await finalizeTaskAssistantMessage(currentAssistantMessage.id, finalAnswer, 'success', { usage: latestUsage })
        break
      }

      const toolResult = await executeToolStep({
        task,
        registry,
        requestedToolCall,
        currentAssistantMessageId: currentAssistantMessage.id,
        currentModelText,
        currentToolMessages,
        runtimeState,
        observations,
        loopMessages,
        step,
        onToolCallContext: (context) => {
          lastToolCallContext = context
        },
      })
      lastToolCallContext = toolResult.lastToolCallContext
    }

    task.snapshot.status = 'success'
    reportTaskState(task.snapshot)
    await appendAgentLog(task.snapshot.taskId, 'task_completed', { finalAnswer })
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
    await writeCheckpoint(task.snapshot)
    if (['success', 'failed', 'cancelled'].includes(task.snapshot.status)) {
      await removeCheckpoint(task.snapshot.taskId)
      taskStore.finish(task.snapshot.taskId)
    }
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
    lastProgress: task.snapshot.progress.at(-1) || null,
    lastToolCallContext,
  }
  if (code === 'AGENT_CANCELLED') {
    task.snapshot.status = 'cancelled'
    markRunningProgress(task, 'skipped')
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
  await appendAgentLog(task.snapshot.taskId, 'task_failed', failurePayload)
  logger.error('[agent-runtime] task_failed', failurePayload)
}
