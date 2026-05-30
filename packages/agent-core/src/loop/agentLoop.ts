import type { AgentRuntimeConfig, AgentTaskSnapshot, LoopMessage, McpToolCall, RuntimeToolDefinition, ToolResultContent } from '@ant-chat/shared'
import type { RuntimeStartInput } from '../session/types'
import type { BeforeToolExecuteHook, ToolCallContext } from '../tools/types'
import { AgentError } from '../AgentError'
import { getAgentLogger } from '../logger'
import { taskStore } from '../taskStore'
import { createInvalidToolArgsResult, executeToolStep } from '../tools/toolExecution'
import { transformErrorMessage } from '../utils/errorMessages'
import { normalizeToolArgs } from './loopContext'

export async function runAgentLoop(input: {
  taskId: string
  options: RuntimeStartInput
  config: AgentRuntimeConfig
  onBeforeTurn?: (ctx: {
    messages: LoopMessage[]
    step: number
  }) => Promise<{ messages: LoopMessage[], systemPrompt?: string }>
  beforeToolExecute: BeforeToolExecuteHook
}) {
  const { taskId, options, config, onBeforeTurn, beforeToolExecute } = input
  const logger = getAgentLogger(config)
  const task = taskStore.get(taskId)
  if (!task)
    throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')

  const {
    messages: initialMessages,
    systemPrompt: initialSystemPrompt,
    registry,
    aiProvider,
    modelName,
    providerName,
    providerId,
    temperature,
    maxTokens,
  } = options

  const toolDefs = registry.listTools()

  let step = 0
  let finalAnswer = ''
  let currentToolMessages: McpToolCall[] = []
  let currentModelText = ''
  let lastToolCallContext: ToolCallContext | null = null
  let loopMessages: LoopMessage[] = [...initialMessages]
  let systemPrompt = initialSystemPrompt

  try {
    for (;;) {
      if (task.abortController.signal.aborted)
        throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
      step += 1

      if (!aiProvider)
        throw new AgentError('AGENT_TOOL_EXEC_FAILED', 'AI provider not ready')

      // === Plan A: 外层 compaction hook（agent-loop 完全无感） ===
      if (onBeforeTurn) {
        const result = await onBeforeTurn({ messages: loopMessages, step })
        loopMessages = result.messages
        if (result.systemPrompt !== undefined) {
          systemPrompt = result.systemPrompt
        }
      }

      // === Steering: 检查是否有运行中追加的用户输入 ===
      const steeringInputs = taskStore.dequeueSteeringInputs(taskId)
      for (const input of steeringInputs) {
        loopMessages.push({ role: 'user', content: [{ type: 'text', text: input.text }] })
      }

      const chatSettings = {
        model: modelName,
        temperature,
        maxTokens,
        systemPrompt,
      }

      await config.eventEmitter.emitTurnStarted({
        conversationId: options.conversationId,
        model: { name: modelName, provider: providerName, providerId },
      })

      currentToolMessages = []

      const requestDiagnostics = createModelRequestDiagnostics({
        messages: loopMessages,
        systemPrompt,
        toolDefs,
      })
      const requestPayload = {
        conversationId: options.conversationId,
        userMessageId: options.userMessageId,
        step,
        messageCount: loopMessages.length,
        toolCount: toolDefs.length,
        model: modelName,
        provider: providerName,
        providerId,
        apiMode: options.apiMode,
        temperature,
        maxTokens,
        ...requestDiagnostics,
      }
      logger.info('agent-runtime', { event: 'model_request_started', ...requestPayload })
      config.taskLogger?.write('model_request_started', requestPayload)

      const stream = aiProvider.streamModel({
        messages: loopMessages,
        chatSettings,
        tools: toolDefs.map(item => ({ ...item, serverName: item.serverName || 'native' })),
        abortSignal: task.abortController.signal,
      })

      let modelText = ''
      const requestedToolCalls: Array<{ id?: string, toolName: string, input: Record<string, unknown>, invalidArgsError?: string }> = []

      for await (const chunk of stream) {
        const content = chunk.content || []
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            modelText += item.text
          }
        }
        const functionCalls = chunk.functionCalls || []
        for (const fc of functionCalls) {
          const argsResult = normalizeToolArgs(fc.args)
          requestedToolCalls.push({
            id: fc.id,
            toolName: fc.toolName,
            input: argsResult.ok ? argsResult.input : {},
            invalidArgsError: argsResult.ok ? undefined : argsResult.error,
          })
        }
        await config.eventEmitter.emitTurnChunk({
          conversationId: options.conversationId,
          accumulatedText: modelText,
          chunk,
        })
      }

      const responsePayload = {
        conversationId: options.conversationId,
        userMessageId: options.userMessageId,
        step,
        textPreview: modelText.slice(0, 1000),
        hasToolCall: requestedToolCalls.length > 0,
        toolCalls: requestedToolCalls.map(call => ({
          id: call.id,
          toolName: call.toolName,
          input: call.input,
          invalidArgsError: call.invalidArgsError,
        })),
      }
      logger.info('agent-runtime', { event: 'model_response_finished', ...responsePayload })
      config.taskLogger?.write('model_response_finished', responsePayload)
      currentModelText = modelText.trim()

      if (requestedToolCalls.length === 0) {
        finalAnswer = currentModelText || 'Task completed.'
        loopMessages.push({ role: 'assistant', content: [{ type: 'text', text: modelText }] })

        await config.eventEmitter.emitTurnFinished({
          conversationId: options.conversationId,
          text: finalAnswer,
          status: 'success',
        })
        break
      }

      interface ToolStepOutcome { toolCallId: string, toolName: string, toolResultContent: string, isError: boolean, lastContext: ToolCallContext }
      const outcomes: ToolStepOutcome[] = []

      for (const rc of requestedToolCalls) {
        if (rc.invalidArgsError) {
          const res = await createInvalidToolArgsResult({
            config,
            conversationId: options.conversationId,
            requestedToolCall: rc,
            currentModelText,
            currentToolMessages,
          })
          outcomes.push({
            toolCallId: res.toolCallId,
            toolName: rc.toolName,
            toolResultContent: res.toolResultContent,
            isError: res.isError,
            lastContext: res.lastToolCallContext,
          })
        }
        else {
          const res = await executeToolStep({
            task,
            registry,
            requestedToolCall: rc,
            currentModelText,
            currentToolMessages,
            step,
            config,
            beforeToolExecute,
            abortSignal: task.abortController.signal,
            onToolCallContext: (context) => {
              lastToolCallContext = context
            },
          })
          outcomes.push({
            toolCallId: res.toolCallId,
            toolName: rc.toolName,
            toolResultContent: res.toolResultContent,
            isError: res.isError,
            lastContext: res.lastToolCallContext,
          })
        }
      }
      lastToolCallContext = outcomes[outcomes.length - 1]?.lastContext ?? lastToolCallContext

      const assistantContent: LoopMessage['content'] = []
      if (modelText.trim()) {
        assistantContent.push({ type: 'text', text: modelText })
      }
      for (let i = 0; i < requestedToolCalls.length; i++) {
        assistantContent.push({
          type: 'tool-call',
          toolCallId: outcomes[i].toolCallId,
          toolName: requestedToolCalls[i].toolName,
          args: requestedToolCalls[i].input,
        })
      }
      loopMessages.push({ role: 'assistant', content: assistantContent })

      const toolResults: ToolResultContent[] = []
      for (const outcome of outcomes) {
        const toolResult: ToolResultContent = {
          type: 'tool-result',
          toolCallId: outcome.toolCallId,
          toolName: outcome.toolName,
          result: outcome.toolResultContent,
          isError: outcome.isError,
        }
        toolResults.push(toolResult)
        loopMessages.push({
          role: 'tool',
          content: [toolResult],
        })
      }
      await config.eventEmitter.emitTurnToolResults?.({
        conversationId: options.conversationId,
        results: toolResults,
      })
    }

    task.snapshot.status = 'success'
    await config.eventEmitter.emitTaskUpdated(task.snapshot)
    logger.info('agent-runtime', { event: 'task_completed', conversationId: options.conversationId, userMessageId: options.userMessageId, finalAnswer })
    config.taskLogger?.write('task_completed', { conversationId: options.conversationId, userMessageId: options.userMessageId, finalAnswer })
  }
  catch (error) {
    await handleLoopFailure({
      config,
      task,
      error: error as Error,
      lastToolCallContext,
    })
  }
  finally {
    task.snapshot.updatedAt = Date.now()
    if (['success', 'failed', 'cancelled'].includes(task.snapshot.status)) {
      taskStore.finish(task.snapshot.taskId)
    }
    // 确保 taskLogger 在 loop 结束时关闭（刷盘 + 释放资源）
    config.taskLogger?.close()
  }
}

async function handleLoopFailure(options: {
  config: AgentRuntimeConfig
  task: NonNullable<ReturnType<typeof taskStore.get>>
  error: Error
  lastToolCallContext: ToolCallContext | null
}) {
  const { config, task, error, lastToolCallContext } = options
  const failurePayload = {
    error: error.message,
    stack: error.stack || '',
    workspacePath: task.snapshot.workspacePath,
    lastToolCallContext,
  }
  if (error instanceof AgentError && error.code === 'AGENT_CANCELLED') {
    task.snapshot.status = 'cancelled'
    await config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      text: 'Task cancelled.',
      status: 'cancel',
    })
  }
  else {
    task.snapshot.status = 'failed'
    task.snapshot.errorCode = (error instanceof AgentError ? error.code : error.message) as AgentTaskSnapshot['errorCode']
    task.snapshot.errorMessage = error.message
    await config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      text: transformErrorMessage(error.message),
      status: 'error',
    })
  }
  await config.eventEmitter.emitTaskUpdated(task.snapshot)
  getAgentLogger(config).error('[agent-runtime] task_failed', failurePayload)
  config.taskLogger?.write('task_failed', { conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, ...failurePayload })
}

function createModelRequestDiagnostics(input: {
  messages: LoopMessage[]
  systemPrompt: string
  toolDefs: RuntimeToolDefinition[]
}) {
  return {
    systemPromptPreview: previewText(input.systemPrompt, 4000),
    messagesPreview: input.messages.map(message => ({
      role: message.role,
      content: message.content.map((part) => {
        if (part.type === 'text') {
          return { type: 'text', text: previewText(part.text, 2000) }
        }
        if (part.type === 'tool-call') {
          return {
            type: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args: part.args,
          }
        }
        return {
          type: 'tool-result',
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          result: typeof part.result === 'string' ? previewText(part.result, 2000) : part.result,
          isError: part.isError,
        }
      }),
    })),
    toolNames: input.toolDefs.map(tool => tool.name),
  }
}

function previewText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`
}
