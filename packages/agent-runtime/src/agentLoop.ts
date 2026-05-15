import type { AgentRuntimeConfig, AgentTaskSnapshot, IMessage, LoopMessage, McpToolCall } from '@ant-chat/shared'
import type { ApprovalDecision } from './approvalController'
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
    // 任务未在 taskStore 中找到
    throw new AgentError('AGENT_TASK_NOT_FOUND', 'Task not found')

  const model = options.modelConfig?.modelId ? await config.modelResolver.getModelById(options.modelConfig.modelId) : null
  const provider = model
    ? config.modelResolver.getProviderById(model.serviceProviderId).then((p) => {
        if (!p)
          throw new AgentError('AGENT_PROVIDER_NOT_FOUND', `Provider not found for model ${model.model}`)
        return p
      })
    : null
  const resolvedProvider = await provider
  const aiProvider = model ? await config.aiProviderFactory(options.modelConfig!.modelId, config.modelResolver) : null
  const tools = await config.toolProvider(task.snapshot.workspacePath, task.snapshot.mode)
  const registry = new ToolRegistry(tools)
  const toolDefs = registry.listTools()
  const loopSystemPrompt = createLoopSystemPrompt(task.snapshot.workspacePath, config.systemPrompt)

  const compactionSettings = { ...DEFAULT_COMPACTION_SETTINGS, ...options.compaction }
  let compactionCount = 0

  let step = 0
  let finalAnswer = ''
  let currentToolMessages: McpToolCall[] = []
  let currentModelText = ''
  let lastToolCallContext: ToolCallContext | null = null
  let loopMessages: LoopMessage[] = []

  try {
    const conversation = await config.conversationQuery.getConversationById(options.conversationId)
    const lastCompactedAt = conversation?.settings?.lastCompactedAt
    const lastCompactionSummary = conversation?.settings?.lastCompactionSummary
    const historyMessages: IMessage[] = await config.conversationQuery.getMessagesByConvId(options.conversationId)
    const contextMessages = buildConversationContextMessages(historyMessages, options.userMessageId, lastCompactedAt, lastCompactionSummary)
    loopMessages.push(...contextMessages)
    loopMessages.push({
      role: 'user',
      content: [{ type: 'text', text: options.prompt }],
    })

    for (;;) {
      if (task.abortController.signal.aborted)
        // 用户请求中止任务
        throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
      step += 1

      if (!aiProvider || !model) {
        // AI 提供者或模型未初始化完成
        throw new AgentError('AGENT_TOOL_EXEC_FAILED', 'AI provider or model not ready')
      }

      if (compactionSettings.enabled && resolvedProvider && config.compactionStrategy) {
        const estimatedTokens = estimateContextTokens(loopMessages)
        const contextWindow = getContextWindow(resolvedProvider.apiMode || 'openai')
        const usagePercent = Math.round(estimatedTokens / contextWindow * 100)
        task.snapshot.contextUsage = { estimatedTokens, contextWindow, usagePercent }

        const compResult = await compactMessages({
          messages: loopMessages,
          preEstimatedTokens: estimatedTokens,
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

      const chatSettings = {
        model: model.model,
        temperature: options.modelConfig?.temperature,
        maxTokens: options.modelConfig?.maxTokens,
        systemPrompt: loopSystemPrompt,
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
            chatSettings,
            tools: toolDefs.map(item => ({ name: item.name, description: item.description, inputSchema: item.inputSchema })),
          },
        })
      }

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
        config.eventEmitter.emitTurnChunk({
          conversationId: options.conversationId,
          accumulatedText: modelText,
          chunk,
        })
      }
      const requestedToolCalls = [...toolCallMap.values()]
      await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'model_response_finished', {
        step,
        textPreview: modelText.slice(0, 500),
        hasToolCall: requestedToolCalls.length > 0,
      })
      currentModelText = modelText.trim()

      if (requestedToolCalls.length === 0) {
        // 模型未返回文本时的最终占位答案
        finalAnswer = currentModelText || 'Task completed.'
        loopMessages.push({ role: 'assistant', content: [{ type: 'text', text: modelText }] })

        config.eventEmitter.emitTurnFinished({
          conversationId: options.conversationId,
          text: finalAnswer,
          status: 'success',
        })
        break
      }

      // Execute all tool calls
      interface ToolStepOutcome { toolCallId: string, toolName: string, toolResultContent: string, isError: boolean, lastContext: ToolCallContext }
      const outcomes: ToolStepOutcome[] = []
      for (const rc of requestedToolCalls) {
        if (rc.invalidArgsError) {
          const res = createInvalidToolArgsResult({
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
            appendAgentLog,
            waitForApproval: approvalController.waitForApproval,
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
      // 通知消费者任务已取消
      text: 'Task cancelled.',
      status: 'cancel',
    })
  }
  else {
    task.snapshot.status = 'failed'
    task.snapshot.errorCode = (error instanceof AgentError ? error.code : error.message) as AgentTaskSnapshot['errorCode']
    task.snapshot.errorMessage = error.message
    config.eventEmitter.emitTurnFinished({
      conversationId: task.snapshot.conversationId,
      // 通知消费者任务执行失败
      text: `Task failed: ${error.message}`,
      status: 'error',
    })
  }
  config.eventEmitter.emitTaskUpdated(task.snapshot)
  await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'task_failed', failurePayload)
  config.logger.error('[agent-runtime] task_failed', failurePayload)
}
