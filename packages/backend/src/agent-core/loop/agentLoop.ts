import type { AgentExecutionPhase, AgentRuntimeConfig, AgentTaskSnapshot, LoopMessage, McpToolCall, RuntimeToolDefinition, ToolResultContent } from '@ant-chat/shared'
import type { BeforeTurnResult, RuntimeStartInput } from '../session/types'
import type { BeforeToolExecuteHook, ToolCallContext } from '../tools/types'
import { AgentError } from '../AgentError'
import { createAgentTraceLogger } from '../agentTraceLogger'
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
  }) => Promise<BeforeTurnResult>
  beforeToolExecute: BeforeToolExecuteHook
}) {
  const { taskId, options, config, onBeforeTurn, beforeToolExecute } = input
  const traceLogger = createAgentTraceLogger(config)
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
  let lastLoggedMessages: LoopMessage[] = []
  let lastLoggedSystemPrompt = ''
  const taskStartedAt = Date.now()

  try {
    for (;;) {
      if (task.abortController.signal.aborted)
        throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
      step += 1

      if (!aiProvider)
        throw new AgentError('AGENT_TOOL_EXEC_FAILED', 'AI provider not ready')

      // === Plan A: 外层 compaction hook（agent-loop 完全无感） ===
      let beforeTurnResult: BeforeTurnResult | undefined
      if (onBeforeTurn) {
        beforeTurnResult = await onBeforeTurn({ messages: loopMessages, step })
        loopMessages = beforeTurnResult.messages
        if (beforeTurnResult.systemPrompt !== undefined) {
          systemPrompt = beforeTurnResult.systemPrompt
        }
      }

      // === Steering: 检查是否有运行中追加的用户输入 ===
      const steeringInputs = taskStore.dequeueSteeringInputs(taskId)
      for (const input of steeringInputs) {
        loopMessages.push({ role: 'user', content: [{ type: 'text', text: input.text }] })
      }

      const modelSettings = {
        model: modelName,
        temperature,
        maxTokens,
        systemPrompt,
      }

      await emitExecutionPhase(config, task, 'waiting_model')

      await config.eventEmitter.emitTurnStarted({
        conversationId: options.conversationId,
        model: { name: modelName, provider: providerName, providerId },
      })

      currentToolMessages = []

      const requestPreview = createRequestPreview({
        messages: loopMessages,
        systemPrompt,
        lastLoggedMessages,
        lastLoggedSystemPrompt,
        step,
        compacted: beforeTurnResult?.compacted ?? false,
      })
      const requestDiagnostics = createModelRequestDiagnostics({
        messages: requestPreview.messages,
        systemPrompt,
        toolDefs,
      })
      const requestPayload = {
        runId: taskId,
        taskId,
        conversationId: options.conversationId,
        userMessageId: options.userMessageId,
        step,
        messageCount: loopMessages.length,
        messagesPreviewKind: requestPreview.kind,
        messagesPreviewStartIndex: requestPreview.startIndex,
        messagesPreviewCount: requestPreview.messages.length,
        contextResetReason: requestPreview.resetReason,
        toolCount: toolDefs.length,
        model: modelName,
        provider: providerName,
        providerId,
        apiMode: options.apiMode,
        temperature,
        maxTokens,
        ...requestDiagnostics,
      }
      traceLogger.write('model_request_started', requestPayload)
      lastLoggedMessages = [...loopMessages]
      lastLoggedSystemPrompt = systemPrompt

      const modelStartedAt = Date.now()
      const stream = aiProvider.streamModel({
        messages: loopMessages,
        modelSettings,
        tools: toolDefs.map(item => ({ ...item, serverName: item.serverName || 'native' })),
        abortSignal: task.abortController.signal,
      })

      let modelText = ''
      let usage: Record<string, number | undefined> | undefined
      let finishReason: string | undefined
      let streamPhase: AgentExecutionPhase = 'waiting_model'
      const requestedToolCalls: Array<{ id?: string, toolName: string, input: Record<string, unknown>, invalidArgsError?: string }> = []

      for await (const chunk of stream) {
        if (chunk.usage) {
          usage = { ...chunk.usage }
        }
        if (chunk.finishReason) {
          finishReason = chunk.finishReason
        }
        if (chunk.reasoningContent && streamPhase === 'waiting_model') {
          streamPhase = 'thinking'
          await emitExecutionPhase(config, task, streamPhase)
        }
        const content = chunk.content || []
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            if (streamPhase !== 'generating_response') {
              streamPhase = 'generating_response'
              await emitExecutionPhase(config, task, streamPhase)
            }
            modelText += item.text
          }
        }
        const functionCalls = chunk.functionCalls || []
        if (functionCalls.length > 0 && requestedToolCalls.length === 0) {
          await emitExecutionPhase(config, task, 'preparing_tool')
        }
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
        runId: taskId,
        taskId,
        conversationId: options.conversationId,
        userMessageId: options.userMessageId,
        step,
        durationMs: Date.now() - modelStartedAt,
        usage,
        finishReason,
        textPreview: modelText.slice(0, 1000),
        hasToolCall: requestedToolCalls.length > 0,
        toolCalls: requestedToolCalls.map(call => ({
          id: call.id,
          toolName: call.toolName,
          input: call.input,
          invalidArgsError: call.invalidArgsError,
        })),
      }
      traceLogger.write('model_response_finished', responsePayload)
      currentModelText = modelText.trim()

      if (requestedToolCalls.length === 0) {
        finalAnswer = currentModelText || 'Task completed.'
        loopMessages.push({ role: 'assistant', content: [{ type: 'text', text: modelText }] })

        await config.eventEmitter.emitTurnFinished({
          conversationId: options.conversationId,
          turnId: options.userMessageId,
          text: finalAnswer,
          status: 'success',
          durationMs: Date.now() - taskStartedAt,
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
          await emitExecutionPhase(config, task, 'using_tool')
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
    const completedPayload = { runId: taskId, taskId, conversationId: options.conversationId, userMessageId: options.userMessageId, durationMs: Date.now() - taskStartedAt, finalAnswer }
    traceLogger.write('task_completed', completedPayload)
  }
  catch (error) {
    await handleLoopFailure({
      config,
      task,
      error: error as Error,
      lastToolCallContext,
      durationMs: Date.now() - taskStartedAt,
    })
  }
  finally {
    await config.secretStore?.clearTurnSecrets(taskId)
    task.snapshot.updatedAt = Date.now()
    if (['success', 'failed', 'cancelled'].includes(task.snapshot.status)) {
      taskStore.finish(task.snapshot.taskId)
    }
    traceLogger.close()
  }
}

async function emitExecutionPhase(
  config: AgentRuntimeConfig,
  task: NonNullable<ReturnType<typeof taskStore.get>>,
  phase: AgentExecutionPhase,
) {
  if (task.snapshot.executionPhase === phase)
    return
  task.snapshot.executionPhase = phase
  task.snapshot.updatedAt = Date.now()
  await config.eventEmitter.emitTaskUpdated(task.snapshot)
}

async function handleLoopFailure(options: {
  config: AgentRuntimeConfig
  task: NonNullable<ReturnType<typeof taskStore.get>>
  error: Error
  lastToolCallContext: ToolCallContext | null
  durationMs: number
}) {
  const { config, task, error, lastToolCallContext, durationMs } = options
  const failurePayload = {
    runId: task.snapshot.taskId,
    taskId: task.snapshot.taskId,
    conversationId: task.snapshot.conversationId,
    userMessageId: task.snapshot.userMessageId,
    durationMs,
    error: error.message,
    stack: error.stack || '',
    workspacePath: task.snapshot.workspacePath,
    lastToolCallContext,
  }
  if (error instanceof AgentError && error.code === 'AGENT_CANCELLED') {
    task.snapshot.status = 'cancelled'
    await config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      turnId: task.snapshot.userMessageId,
      text: 'Task cancelled.',
      status: 'cancel',
      durationMs,
    })
  }
  else {
    task.snapshot.status = 'failed'
    task.snapshot.errorCode = (error instanceof AgentError ? error.code : error.message) as AgentTaskSnapshot['errorCode']
    task.snapshot.errorMessage = error.message
    await config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      turnId: task.snapshot.userMessageId,
      text: transformErrorMessage(error.message),
      status: 'error',
      durationMs,
    })
  }
  await config.eventEmitter.emitTaskUpdated(task.snapshot)
  createAgentTraceLogger(config).write('task_failed', failurePayload)
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
        if (part.type === 'image') {
          return {
            type: 'image',
            mimeType: part.mimeType,
            dataPreview: `${part.data.slice(0, 100)}...`,
          }
        }
        if (part.type === 'file') {
          return {
            type: 'file',
            mimeType: part.mimeType,
            dataPreview: `${part.data.slice(0, 100)}...`,
          }
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

function createRequestPreview(input: {
  messages: LoopMessage[]
  systemPrompt: string
  lastLoggedMessages: LoopMessage[]
  lastLoggedSystemPrompt: string
  step: number
  compacted: boolean
}): {
  kind: 'full' | 'delta'
  messages: LoopMessage[]
  startIndex: number
  resetReason?: 'initial' | 'compaction' | 'system_prompt_changed' | 'history_rewritten'
} {
  if (input.step === 1) {
    return { kind: 'full', messages: input.messages, startIndex: 0, resetReason: 'initial' }
  }
  if (input.compacted) {
    return { kind: 'full', messages: input.messages, startIndex: 0, resetReason: 'compaction' }
  }
  if (input.systemPrompt !== input.lastLoggedSystemPrompt) {
    return { kind: 'full', messages: input.messages, startIndex: 0, resetReason: 'system_prompt_changed' }
  }
  if (!isMessagePrefix(input.lastLoggedMessages, input.messages)) {
    return { kind: 'full', messages: input.messages, startIndex: 0, resetReason: 'history_rewritten' }
  }

  return {
    kind: 'delta',
    messages: input.messages.slice(input.lastLoggedMessages.length),
    startIndex: input.lastLoggedMessages.length,
  }
}

function isMessagePrefix(prefix: LoopMessage[], messages: LoopMessage[]): boolean {
  if (prefix.length > messages.length) {
    return false
  }
  for (let i = 0; i < prefix.length; i++) {
    if (JSON.stringify(prefix[i]) !== JSON.stringify(messages[i])) {
      return false
    }
  }
  return true
}

function previewText(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength)}\n...[truncated ${value.length - maxLength} chars]`
}
