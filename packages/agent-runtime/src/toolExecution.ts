import type { AgentPendingAction, AgentRuntimeConfig, McpToolCall } from '@ant-chat/shared'
import type { ApprovalDecision } from './approvalController'
import type { RuntimeTask } from './taskStore'
import type { PreparedToolCall, ToolRegistry } from './toolRegistry'
import { randomUUID } from 'node:crypto'
import { AgentError } from './AgentError'
import { decidePolicy } from './policyEngine'
import { truncateText } from './utils'

const DEFAULT_TOOL_OBSERVATION_LIMIT = 4000
const DEFAULT_TOOL_LOG_PREVIEW_LIMIT = 4000

export interface RequestedToolCall {
  toolName: string
  input: Record<string, unknown>
}

export interface ToolCallContext {
  toolName: string
  input: Record<string, unknown>
  operationType: string
  scope: string
  policy: string
}

export interface ExecuteToolStepOptions {
  task: RuntimeTask
  registry: ToolRegistry
  requestedToolCall: RequestedToolCall
  currentAssistantMessageId: string
  currentModelText: string
  currentToolMessages: McpToolCall[]
  step: number
  config: AgentRuntimeConfig
  appendAgentLog: (conversationId: string, userMessageId: string, event: string, payload: Record<string, unknown>) => Promise<string>
  waitForApproval: (task: RuntimeTask) => Promise<ApprovalDecision>
  onToolCallContext?: (context: ToolCallContext) => void
}

export interface ExecuteToolStepResult {
  lastToolCallContext: ToolCallContext
  toolCallId: string
  toolResultContent: string
  isError: boolean
}

export async function executeToolStep(options: ExecuteToolStepOptions): Promise<ExecuteToolStepResult> {
  const {
    task,
    registry,
    requestedToolCall,
    currentAssistantMessageId,
    currentModelText,
    currentToolMessages,
    step,
    config,
    appendAgentLog,
    waitForApproval,
    onToolCallContext,
  } = options

  await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'tool_call_received', {
    step,
    toolName: requestedToolCall.toolName,
    input: requestedToolCall.input,
  })

  const prepared = registry.prepare(requestedToolCall.toolName, requestedToolCall.input)

  const currentToolCall: McpToolCall = {
    id: randomUUID(),
    serverName: prepared.source,
    toolName: requestedToolCall.toolName,
    args: requestedToolCall.input,
    executeState: 'executing',
  }
  currentToolMessages.push(currentToolCall)
  await updateAssistantMessage(config, currentAssistantMessageId, currentModelText, currentToolMessages)

  let lastObservation = ''
  const policyDecision = decidePolicy(task.snapshot.mode, prepared.operationType, prepared.scope)
  const lastToolCallContext = {
    toolName: requestedToolCall.toolName,
    input: requestedToolCall.input,
    operationType: prepared.operationType,
    scope: prepared.scope,
    policy: policyDecision.type,
  }
  onToolCallContext?.(lastToolCallContext)

  await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'tool_decision', {
    toolName: requestedToolCall.toolName,
    input: requestedToolCall.input,
    operationType: prepared.operationType,
    scope: prepared.scope,
    policy: policyDecision.type,
    workspacePath: task.snapshot.workspacePath,
  })

  if (prepared.validationError) {
    currentToolCall.executeState = 'completed'
    currentToolCall.result = {
      success: false,
      error: prepared.validationError,
    }
    await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'tool_failed', {
      toolName: prepared.toolName,
      input: requestedToolCall.input,
      error: prepared.validationError,
      workspacePath: task.snapshot.workspacePath,
    })
    lastObservation = formatFailure(prepared, prepared.validationError, requestedToolCall.input)
    await updateAssistantMessage(config, currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
    return {
      lastToolCallContext,
      toolCallId: currentToolCall.id,
      toolResultContent: lastObservation,
      isError: true,
    }
  }

  if (policyDecision.type === 'block') {
    currentToolCall.executeState = 'completed'
    currentToolCall.result = {
      success: false,
      error: policyDecision.errorCode,
    }
    await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'tool_blocked', {
      step,
      toolName: requestedToolCall.toolName,
      input: requestedToolCall.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: policyDecision.type,
      reason: policyDecision.reason,
      errorCode: policyDecision.errorCode,
      workspacePath: task.snapshot.workspacePath,
    })
    lastObservation = formatFailure(prepared, policyDecision.errorCode, requestedToolCall.input)
    await updateAssistantMessage(config, currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
    return {
      lastToolCallContext,
      toolCallId: currentToolCall.id,
      toolResultContent: lastObservation,
      isError: true,
    }
  }

  if (policyDecision.type === 'require_approval') {
    const pendingAction: AgentPendingAction = {
      actionId: randomUUID(),
      toolName: prepared.toolName,
      operationType: prepared.operationType,
      scope: prepared.scope,
      inputPreview: JSON.stringify(requestedToolCall.input).slice(0, 200),
      createdAt: Date.now(),
    }
    task.snapshot.status = 'awaiting_approval'
    task.snapshot.pendingAction = pendingAction
    config.eventEmitter.emitTaskUpdated(task.snapshot)
    config.eventEmitter.emitApprovalRequired(task.snapshot.taskId, task.snapshot.conversationId, pendingAction)
    await config.messageStore.updateMessage(currentAssistantMessageId, {
      status: 'loading',
      content: [{ type: 'text', text: currentModelText }],
    })

    const decisionResult = await waitForApproval(task)
    if (task.abortController.signal.aborted || decisionResult.reason === 'AGENT_CANCELLED') {
      throw new AgentError('AGENT_CANCELLED', '任务已取消')
    }

    if (!decisionResult.approved) {
      currentToolCall.executeState = 'completed'
      currentToolCall.result = {
        success: false,
        error: decisionResult.reason || 'AGENT_APPROVAL_REJECTED',
      }
      lastObservation = `工具 ${prepared.toolName} 被拒绝: ${decisionResult.reason || '无原因'}`
      await updateAssistantMessage(config, currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
      return {
        lastToolCallContext,
        toolCallId: currentToolCall.id,
        toolResultContent: lastObservation,
        isError: true,
      }
    }
  }

  const result = await prepared.execute()
  if (!result.ok) {
    currentToolCall.executeState = 'completed'
    currentToolCall.result = {
      success: false,
      error: result.error || 'AGENT_TOOL_EXEC_FAILED',
    }
    await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'tool_failed', {
      toolName: prepared.toolName,
      input: requestedToolCall.input,
      error: result.error || 'AGENT_TOOL_EXEC_FAILED',
      workspacePath: task.snapshot.workspacePath,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    })
    lastObservation = formatFailure(prepared, result.error || 'AGENT_TOOL_EXEC_FAILED', requestedToolCall.input, result)
    await updateAssistantMessage(config, currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
    return {
      lastToolCallContext,
      toolCallId: currentToolCall.id,
      toolResultContent: lastObservation,
      isError: true,
    }
  }

  const toolOutputText = getToolOutputText(result)
  lastObservation = buildObservation(prepared, result, toolOutputText)
  const shouldTruncate = prepared.truncateObservation !== false
  const dataText = shouldTruncate ? truncateText(toolOutputText, DEFAULT_TOOL_OBSERVATION_LIMIT) : toolOutputText
  const logPreview = shouldTruncate ? truncateText(toolOutputText, DEFAULT_TOOL_LOG_PREVIEW_LIMIT) : toolOutputText
  currentToolCall.executeState = 'completed'
  currentToolCall.result = {
    success: true,
    data: dataText,
  }
  await updateAssistantMessage(config, currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
  await appendAgentLog(task.snapshot.conversationId, task.snapshot.userMessageId, 'tool_completed', {
    toolName: prepared.toolName,
    input: requestedToolCall.input,
    outputPreview: logPreview,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
  })

  return {
    lastToolCallContext,
    toolCallId: currentToolCall.id,
    toolResultContent: lastObservation,
    isError: false,
  }
}

function updateAssistantMessage(
  config: AgentRuntimeConfig,
  messageId: string,
  text: string,
  toolMessages: McpToolCall[],
  status: 'loading' | 'success' = 'loading',
) {
  return config.messageStore.updateMessage(messageId, {
    status,
    content: [{ type: 'text', text }],
    toolCalls: [...toolMessages],
  })
}

function getToolOutputText(result: { output?: unknown, stdout?: string, stderr?: string, exitCode?: number }): string {
  if (typeof result.output === 'string') {
    return result.output
  }
  if (result.output !== undefined) {
    if (isSkillLoadedOutput(result.output)) {
      return [
        `Skill loaded: ${result.output.name}`,
        '',
        'Instructions:',
        result.output.content,
        '',
        'Use these instructions for the current task. Continue by calling the appropriate native tools or provide the final answer if enough information is available.',
      ].join('\n')
    }
    const text = JSON.stringify(result.output)
    if (typeof text === 'string' && text.length > 0) {
      return text
    }
  }
  if (result.stdout || result.stderr) {
    return [result.stdout || '', result.stderr || ''].filter(Boolean).join('\n')
  }
  if (typeof result.exitCode === 'number') {
    return `exitCode=${result.exitCode}`
  }
  return ''
}

function isSkillLoadedOutput(output: unknown): output is { type: 'skill_loaded', name: string, content: string } {
  return Boolean(
    output
    && typeof output === 'object'
    && (output as Record<string, unknown>).type === 'skill_loaded'
    && typeof (output as Record<string, unknown>).name === 'string'
    && typeof (output as Record<string, unknown>).content === 'string',
  )
}

function buildObservation(
  prepared: PreparedToolCall,
  result: { output?: unknown, stdout?: string, stderr?: string, exitCode?: number },
  outputText: string,
): string {
  if (prepared.formatObservation) {
    return prepared.formatObservation(result, outputText)
  }
  const truncated = prepared.truncateObservation !== false
    ? truncateText(outputText, DEFAULT_TOOL_OBSERVATION_LIMIT)
    : outputText
  return `工具 ${prepared.toolName} 执行成功，输出: ${truncated}`
}

export async function createInvalidToolArgsResult(options: {
  config: AgentRuntimeConfig
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
  const { config, requestedToolCall, currentAssistantMessageId, currentModelText, currentToolMessages } = options
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
  await config.messageStore.updateMessage(currentAssistantMessageId, {
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

function formatFailure(
  prepared: PreparedToolCall,
  error: string,
  input: Record<string, unknown>,
  result?: { stdout?: string, stderr?: string, exitCode?: number },
): string {
  if (prepared.formatError) {
    const formatted = prepared.formatError(error, input, result)
    if (formatted) {
      return formatted
    }
  }
  if (result?.stderr || result?.stdout || result?.exitCode !== undefined) {
    const parts: string[] = []
    if (result.stderr) {
      parts.push(`stderr:\n${result.stderr}`)
    }
    if (result.stdout) {
      parts.push(`stdout:\n${result.stdout}`)
    }
    if (result.exitCode !== undefined) {
      parts.push(`exitCode=${result.exitCode}`)
    }
    return `工具 ${prepared.toolName} 执行失败：${error}\n${parts.join('\n')}`
  }
  return `工具 ${prepared.toolName} 执行失败：${error}`
}
