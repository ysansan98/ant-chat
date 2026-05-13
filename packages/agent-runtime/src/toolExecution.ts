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
  config.eventEmitter.emitTurnToolCalls({
    conversationId: task.snapshot.conversationId,
    text: currentModelText,
    toolCalls: [...currentToolMessages],
  })

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
    await emitToolCalls(config, task.snapshot.conversationId, currentModelText, currentToolMessages)
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
    await emitToolCalls(config, task.snapshot.conversationId, currentModelText, currentToolMessages)
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

    const decisionResult = await waitForApproval(task)
    if (task.abortController.signal.aborted || decisionResult.reason === 'AGENT_CANCELLED') {
      throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
    }

    if (!decisionResult.approved) {
      currentToolCall.executeState = 'completed'
      currentToolCall.result = {
        success: false,
        error: decisionResult.reason || 'AGENT_APPROVAL_REJECTED',
      }
      // 工具被用户拒绝
      lastObservation = `Tool ${prepared.toolName} rejected: ${decisionResult.reason || 'no reason given'}`
      await emitToolCalls(config, task.snapshot.conversationId, currentModelText, currentToolMessages)
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
    await emitToolCalls(config, task.snapshot.conversationId, currentModelText, currentToolMessages)
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
  await emitToolCalls(config, task.snapshot.conversationId, currentModelText, currentToolMessages)
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

function emitToolCalls(
  config: AgentRuntimeConfig,
  conversationId: string,
  text: string,
  toolMessages: McpToolCall[],
) {
  config.eventEmitter.emitTurnToolCalls({
    conversationId,
    text,
    toolCalls: [...toolMessages],
  })
}

function getToolOutputText(result: { output?: unknown, stdout?: string, stderr?: string, exitCode?: number }): string {
  if (typeof result.output === 'string') {
    return result.output
  }
  if (result.output !== undefined) {
    const text = typeof result.output === 'string' ? result.output : JSON.stringify(result.output)
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
  // 工具执行成功的观测文本，供模型下一轮决策
  return `Tool ${prepared.toolName} succeeded, output: ${truncated}`
}

export async function createInvalidToolArgsResult(options: {
  config: AgentRuntimeConfig
  conversationId: string
  requestedToolCall: { toolName: string, input: Record<string, unknown>, invalidArgsError?: string }
  currentModelText: string
  currentToolMessages: McpToolCall[]
}): Promise<{
  lastToolCallContext: ToolCallContext
  toolCallId: string
  toolResultContent: string
  isError: boolean
}> {
  const { config, conversationId, requestedToolCall, currentModelText, currentToolMessages } = options
  const toolCallId = randomUUID()
  // 模型调用工具时参数格式错误，返回提示让模型修正
  const error = `Tool ${requestedToolCall.toolName} argument error: ${requestedToolCall.invalidArgsError || 'args must be a JSON object'}. Fix the arguments and retry.`
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
  config.eventEmitter.emitTurnToolCalls({
    conversationId,
    // 参数解析失败时的占位文本，通知消费者模型需要修正参数
    text: currentModelText || 'Tool argument error, waiting for model to correct.',
    toolCalls: [...currentToolMessages],
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
    // 工具执行失败，附上 stderr/stdout 帮助模型诊断
    return `Tool ${prepared.toolName} failed: ${error}\n${parts.join('\n')}`
  }
  // 工具执行失败的简单反馈
  return `Tool ${prepared.toolName} failed: ${error}`
}
