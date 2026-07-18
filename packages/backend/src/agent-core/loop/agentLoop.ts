import type { AgentExecutionPhase, AgentObservationSpan, AgentRuntimeConfig, AgentTaskSnapshot, LoopMessage, McpToolCall, ToolResultContent } from '@ant-chat/shared'
import type { RuntimeStartInput } from '../session/types'
import type { RuntimeTask, TaskExecution } from '../taskStore'
import type { ToolAuthorization, ToolCallContext } from '../tools/types'
import { AgentError } from '../AgentError'
import { cancelObservation, completeObservation, failObservation, finishTurnObservation, recordContextObservation, startObservationSpan } from '../observation'
import { createInvalidToolArgsResult, executeToolStep } from '../tools/toolExecution'
import { transformErrorMessage } from '../utils/errorMessages'
import { normalizeToolArgs } from './loopContext'

export async function runAgentLoop(input: {
  execution: TaskExecution
  options: RuntimeStartInput
  config: AgentRuntimeConfig
  beforeToolExecute: ToolAuthorization
}) {
  const { execution, options, config, beforeToolExecute } = input
  const { task } = execution
  const { taskId } = task.snapshot

  const {
    messages: initialMessages,
    systemPrompt: initialSystemPrompt,
    registry,
    aiProvider,
    modelName,
    providerName,
    providerId,
    temperature,
    maxOutputTokens,
    reasoningEffort,
  } = options

  const toolDefs = registry.listTools()

  let step = 0
  let finalAnswer = ''
  let currentToolMessages: McpToolCall[] = []
  let currentModelText = ''
  let lastToolCallContext: ToolCallContext | null = null
  const loopMessages: LoopMessage[] = [...initialMessages]
  const systemPrompt = initialSystemPrompt
  const taskStartedAt = Date.now()

  try {
    for (;;) {
      if (task.abortController.signal.aborted)
        throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
      step += 1

      if (!aiProvider)
        throw new AgentError('AGENT_TOOL_EXEC_FAILED', 'AI provider not ready')

      // === Steering: 检查是否有运行中追加的用户输入 ===
      const steeringInputs = execution.dequeueSteeringInputs()
      for (const steering of steeringInputs) {
        loopMessages.push({ role: 'user', content: [{ type: 'text', text: steering.text }] })
        recordContextObservation(config, {
          kind: 'steering',
          messageId: steering.messageId,
          turnId: steering.turnId,
          text: steering.text,
        })
      }

      const modelSettings = {
        model: modelName,
        temperature,
        maxOutputTokens,
        systemPrompt,
        reasoningEffort,
      }

      await emitExecutionPhase(config, task, 'waiting_model')

      await config.eventEmitter.emitTurnStarted({
        conversationId: options.conversationId,
        model: { name: modelName, provider: providerName, providerId },
      })

      currentToolMessages = []

      const modelRequest = {
        messages: loopMessages,
        modelSettings,
        tools: toolDefs.map(item => ({ ...item, serverName: item.serverName || 'native' })),
        abortSignal: task.abortController.signal,
      }
      const modelSpan = startObservationSpan(config, recorder => recorder.startModelRequest(modelRequest))

      const modelStartedAt = Date.now()
      let modelText = ''
      let usage: Record<string, number | undefined> | undefined
      let finishReason: string | undefined
      let streamPhase: AgentExecutionPhase = 'waiting_model'
      const requestedToolCalls: Array<{ id?: string, toolName: string, input: Record<string, unknown>, invalidArgsError?: string }> = []
      const responseChunks: import('@ant-chat/shared').IAIStreamChunk[] = []
      // 将 model span 的 id 作为后续 tool/policy span 的父 span
      const modelSpanId = modelSpan?.id || undefined

      try {
        const stream = aiProvider.streamModel(modelRequest)
        for await (const chunk of stream) {
          responseChunks.push(chunk)
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
      }
      catch (error) {
        finishModelSpan(modelSpan, task.abortController.signal, error, config)
        throw error
      }

      completeObservation(modelSpan, {
        text: modelText,
        durationMs: Date.now() - modelStartedAt,
        usage,
        finishReason,
        toolCalls: requestedToolCalls,
        chunks: responseChunks,
      }, config.logger)
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
            requestedToolCall: {
              ...rc,
              input: rc.input,
            },
            currentModelText,
            currentToolMessages,
            step,
            parentSpanId: modelSpanId,
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
            parentSpanId: modelSpanId,
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
    task.snapshot.summary = finalAnswer || 'Task completed.'
    await config.eventEmitter.emitTaskUpdated(task.snapshot)
    finishTurnObservation(config, { status: 'success', output: { finalAnswer, durationMs: Date.now() - taskStartedAt } })
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
    try {
      await config.secretStore?.clearTurnSecrets(taskId)
    }
    finally {
      task.snapshot.updatedAt = Date.now()
      finishTurnObservation(config, task.snapshot.status === 'success'
        ? { status: 'success', output: { finalAnswer, durationMs: Date.now() - taskStartedAt } }
        : task.snapshot.status === 'cancelled'
          ? { status: 'cancelled', error: task.snapshot.errorMessage }
          : { status: 'failed', error: task.snapshot.errorMessage ?? task.snapshot.summary })
      if (['success', 'failed', 'cancelled'].includes(task.snapshot.status)) {
        execution.finish()
      }
    }
  }
}

async function emitExecutionPhase(
  config: AgentRuntimeConfig,
  task: RuntimeTask,
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
  task: RuntimeTask
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
    task.snapshot.summary = '任务已取消'
    await config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      turnId: task.snapshot.userMessageId,
      text: '用户主动取消.',
      status: 'cancel',
      durationMs,
    })
  }
  else {
    task.snapshot.status = 'failed'
    task.snapshot.errorCode = (error instanceof AgentError ? error.code : error.message) as AgentTaskSnapshot['errorCode']
    task.snapshot.errorMessage = error.message
    task.snapshot.summary = error.message
    await config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      turnId: task.snapshot.userMessageId,
      text: transformErrorMessage(error.message),
      status: 'error',
      durationMs,
    })
  }
  await config.eventEmitter.emitTaskUpdated(task.snapshot)
  finishTurnObservation(config, error instanceof AgentError && error.code === 'AGENT_CANCELLED'
    ? { status: 'cancelled', error: failurePayload }
    : { status: 'failed', error: failurePayload })
}

function finishModelSpan(span: AgentObservationSpan | undefined, signal: AbortSignal, error: unknown, config: AgentRuntimeConfig): void {
  if (signal.aborted) {
    cancelObservation(span, error, config.logger)
  }
  else {
    failObservation(span, error, config.logger)
  }
}
