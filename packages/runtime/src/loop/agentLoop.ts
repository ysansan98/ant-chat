import type { AgentRuntimeConfig, AgentTaskSnapshot, LoopMessage, McpToolCall } from '@ant-chat/shared'
import type { RuntimeStartInput } from '../session/types'
import type { BeforeToolExecuteHook, ToolCallContext } from './types'
import { AgentError } from '../AgentError'
import { normalizeToolArgs } from './loopContext'
import { taskStore } from './taskStore'
import { createInvalidToolArgsResult, executeToolStep } from './toolExecution'
import { ToolRegistry } from './toolRegistry'

export async function runAgentLoop(input: {
  taskId: string
  options: RuntimeStartInput
  config: AgentRuntimeConfig
  onBeforeTurn?: (ctx: {
    messages: LoopMessage[]
    step: number
  }) => Promise<{ messages: LoopMessage[] }>
  beforeToolExecute: BeforeToolExecuteHook
}) {
  const { taskId, options, config, onBeforeTurn, beforeToolExecute } = input
  const task = taskStore.get(taskId)
  if (!task)
    throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')

  const {
    messages: initialMessages,
    systemPrompt,
    tools,
    aiProvider,
    modelName,
    providerName,
    providerId,
    temperature,
    maxTokens,
  } = options

  const registry = new ToolRegistry(tools)
  const toolDefs = registry.listTools()

  let step = 0
  let finalAnswer = ''
  let currentToolMessages: McpToolCall[] = []
  let currentModelText = ''
  let lastToolCallContext: ToolCallContext | null = null
  let loopMessages: LoopMessage[] = [...initialMessages]

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

      config.logger.info('agent-runtime', { event: 'model_request_started', conversationId: options.conversationId, userMessageId: options.userMessageId, step, messageCount: loopMessages.length, toolCount: toolDefs.length })

      const stream = aiProvider.streamModel({
        messages: loopMessages,
        chatSettings,
        tools: toolDefs.map(item => ({ ...item, serverName: 'native' })),
        abortSignal: task.abortController.signal,
      })

      let modelText = ''
      const toolCallMap = new Map<string, { toolName: string, input: Record<string, unknown>, invalidArgsError?: string }>()

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
          toolCallMap.set(fc.toolName, {
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

      const requestedToolCalls = [...toolCallMap.values()]

      config.logger.info('agent-runtime', { event: 'model_response_finished', conversationId: options.conversationId, userMessageId: options.userMessageId, step, textPreview: modelText.slice(0, 500), hasToolCall: requestedToolCalls.length > 0 })
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

      for (const outcome of outcomes) {
        loopMessages.push({
          role: 'tool',
          content: [{
            type: 'tool-result',
            toolCallId: outcome.toolCallId,
            toolName: outcome.toolName,
            result: outcome.toolResultContent,
            isError: outcome.isError,
          }],
        })
      }
    }

    task.snapshot.status = 'success'
    await config.eventEmitter.emitTaskUpdated(task.snapshot)
    config.logger.info('agent-runtime', { event: 'task_completed', conversationId: options.conversationId, userMessageId: options.userMessageId, finalAnswer })
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
      text: `Task failed: ${error.message}`,
      status: 'error',
    })
  }
  await config.eventEmitter.emitTaskUpdated(task.snapshot)
  config.logger.error('[agent-runtime] task_failed', failurePayload)
}
