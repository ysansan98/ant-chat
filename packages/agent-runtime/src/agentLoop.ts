import type { AgentRuntimeConfig, AgentTaskSnapshot, IMessage, LoopMessage, McpToolCall } from '@ant-chat/shared'
import type { ApprovalDecision } from './approvalController'
import type { CompactionSettings } from './compaction'
import type { ToolCallContext } from './toolExecution'
import type { RuntimeStartInput } from './types'
import { AgentError } from './AgentError'
import {
  compactMessages,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  getContextWindow,
} from './compaction'
import {
  buildConversationContextMessages,
  createLoopSystemPrompt,
  normalizeToolArgs,
} from './loopContext'
import { taskStore } from './taskStore'
import { createInvalidToolArgsResult, executeToolStep } from './toolExecution'
import { ToolRegistry } from './toolRegistry'

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
    throw new AgentError('AGENT_TASK_NOT_FOUND', '任务未找到')

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
  let currentToolMessages: McpToolCall[] = []
  let currentModelText = ''
  let lastToolCallContext: ToolCallContext | null = null
  let loopMessages: LoopMessage[] = []

  try {
    const conversation = await config.conversationQuery.getConversationById(options.conversationId)
    const lastCompactedAt = conversation?.settings?.lastCompactedAt as number | undefined
    const lastCompactionSummary = conversation?.settings?.lastCompactionSummary as string | undefined
    const historyMessages: IMessage[] = await config.conversationQuery.getMessagesByConvId(options.conversationId)
    const contextMessages = buildConversationContextMessages(historyMessages, options.userMessageId, lastCompactedAt, lastCompactionSummary)
    loopMessages.push(...contextMessages)
    loopMessages.push({
      role: 'user',
      content: [{ type: 'text', text: options.prompt }],
    })

    for (;;) {
      if (task.abortController.signal.aborted)
        throw new AgentError('AGENT_CANCELLED', '任务已取消')
      step += 1

      if (!aiProvider || !model) {
        throw new AgentError('AGENT_TOOL_EXEC_FAILED', 'AI 提供者或模型未就绪')
      }

      if (compactionSettings.enabled && resolvedProvider && step > 1 && config.compactionStrategy) {
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
          summarize: config.compactionStrategy.summarize,
        })
        if (compResult.compacted) {
          loopMessages = compResult.messages
          compactionCount++

          task.snapshot.lastCompactionAt = Date.now()

          try {
            const compactedAt = Date.now()
            const summary = compResult.summaryText || ''

            config.eventEmitter.emitCompactionSaved({
              conversationId: options.conversationId,
              summary,
              compactedAt,
            })
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

      config.eventEmitter.emitTurnStarted({
        conversationId: options.conversationId,
        model: {
          name: model?.name ?? 'agent-runtime',
          provider: resolvedProvider?.name ?? 'agent-runtime',
          providerId: resolvedProvider?.id ?? 'agent-runtime',
        },
      })
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
      let requestedToolCall: { toolName: string, input: Record<string, unknown>, invalidArgsError?: string } | null = null

      for await (const chunk of stream) {
        const content = chunk.content || []
        for (const item of content) {
          if (item.type === 'text' && item.text) {
            modelText += item.text
          }
        }
        const functionCalls = chunk.functionCalls || []
        if (functionCalls.length > 0) {
          const fc = functionCalls[0]
          const argsResult = normalizeToolArgs(fc.args)
          requestedToolCall = {
            toolName: fc.toolName,
            input: argsResult.ok ? argsResult.input : {},
            invalidArgsError: argsResult.ok ? undefined : argsResult.error,
          }
        }
        config.eventEmitter.emitTurnChunk({
          conversationId: options.conversationId,
          accumulatedText: modelText,
          chunk,
        })
      }
      await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'model_response_finished', {
        step,
        textPreview: modelText.slice(0, 500),
        hasToolCall: Boolean(requestedToolCall),
      })
      currentModelText = modelText.trim()

      if (!requestedToolCall) {
        finalAnswer = currentModelText || '任务已完成。'
        loopMessages.push({ role: 'assistant', content: [{ type: 'text', text: modelText }] })

        config.eventEmitter.emitTurnFinished({
          conversationId: options.conversationId,
          text: finalAnswer,
          status: 'success',
        })
        break
      }

      const toolStepResult = requestedToolCall.invalidArgsError
        ? await createInvalidToolArgsResult({
            config,
            conversationId: options.conversationId,
            requestedToolCall,
            currentModelText,
            currentToolMessages,
          })
        : await executeToolStep({
            task,
            registry,
            requestedToolCall,
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
      lastToolCallContext,
      appendAgentLog,
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
  appendAgentLog: (conversationId: string, userMessageId: string, event: string, payload: Record<string, unknown>) => Promise<string>
}) {
  const { config, task, error, lastToolCallContext, appendAgentLog } = options
  const failurePayload = {
    error: error.message,
    stack: error.stack || '',
    workspacePath: task.snapshot.workspacePath,
    lastToolCallContext,
  }
  if (error instanceof AgentError && error.code === 'AGENT_CANCELLED') {
    task.snapshot.status = 'cancelled'
    config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      text: '任务已取消',
      status: 'cancel',
    })
  }
  else {
    task.snapshot.status = 'failed'
    task.snapshot.errorCode = (error instanceof AgentError ? error.code : error.message) as AgentTaskSnapshot['errorCode']
    task.snapshot.errorMessage = error.message
    config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      text: `任务失败：${error.message}`,
      status: 'error',
    })
  }
  config.eventEmitter.emitTaskUpdated(task.snapshot)
  await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'task_failed', failurePayload)
  config.logger.error('[agent-runtime] task_failed', failurePayload)
}
