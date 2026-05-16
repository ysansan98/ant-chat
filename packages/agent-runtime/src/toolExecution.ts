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
    waitForApproval,
    onToolCallContext,
  } = options

  config.logger.info('agent-runtime', { event: 'tool_call_received', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, step, toolName: requestedToolCall.toolName, input: requestedToolCall.input })

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

  config.logger.info('agent-runtime', { event: 'tool_decision', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, toolName: requestedToolCall.toolName, input: requestedToolCall.input, operationType: prepared.operationType, scope: prepared.scope, policy: policyDecision.type, workspacePath: task.snapshot.workspacePath })

  if (prepared.validationError) {
    config.logger.info('agent-runtime', { event: 'tool_failed', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, toolName: prepared.toolName, input: requestedToolCall.input, error: prepared.validationError, workspacePath: task.snapshot.workspacePath })
    return finalizeToolError(
      currentToolCall,
      prepared.validationError,
      formatFailure(prepared, prepared.validationError, requestedToolCall.input),
      lastToolCallContext,
      config,
      task.snapshot.conversationId,
      currentModelText,
      currentToolMessages,
    )
  }

  if (policyDecision.type === 'block') {
    config.logger.info('agent-runtime', { event: 'tool_blocked', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, step, toolName: requestedToolCall.toolName, input: requestedToolCall.input, operationType: prepared.operationType, scope: prepared.scope, policy: policyDecision.type, reason: policyDecision.reason, errorCode: policyDecision.errorCode, workspacePath: task.snapshot.workspacePath })
    return finalizeToolError(
      currentToolCall,
      policyDecision.errorCode,
      formatFailure(prepared, policyDecision.errorCode, requestedToolCall.input),
      lastToolCallContext,
      config,
      task.snapshot.conversationId,
      currentModelText,
      currentToolMessages,
    )
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
      return finalizeToolError(
        currentToolCall,
        decisionResult.reason || 'AGENT_APPROVAL_REJECTED',
        `Tool ${prepared.toolName} rejected: ${decisionResult.reason || 'no reason given'}`,
        lastToolCallContext,
        config,
        task.snapshot.conversationId,
        currentModelText,
        currentToolMessages,
      )
    }
  }

  const result = await prepared.execute()
  if (!result.ok) {
    const errorMsg = result.error || 'AGENT_TOOL_EXEC_FAILED'
    config.logger.info('agent-runtime', { event: 'tool_failed', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, toolName: prepared.toolName, input: requestedToolCall.input, error: errorMsg, workspacePath: task.snapshot.workspacePath, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode })
    return finalizeToolError(
      currentToolCall,
      errorMsg,
      formatFailure(prepared, errorMsg, requestedToolCall.input, result),
      lastToolCallContext,
      config,
      task.snapshot.conversationId,
      currentModelText,
      currentToolMessages,
    )
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
  config.logger.info('agent-runtime', { event: 'tool_completed', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, toolName: prepared.toolName, input: requestedToolCall.input, outputPreview: logPreview, exitCode: result.exitCode, durationMs: result.durationMs })

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

async function finalizeToolError(
  currentToolCall: McpToolCall,
  error: string,
  lastObservation: string,
  lastToolCallContext: ToolCallContext,
  config: AgentRuntimeConfig,
  conversationId: string,
  currentModelText: string,
  currentToolMessages: McpToolCall[],
): Promise<ExecuteToolStepResult> {
  currentToolCall.executeState = 'completed'
  currentToolCall.result = { success: false, error }
  await emitToolCalls(config, conversationId, currentModelText, currentToolMessages)
  return {
    lastToolCallContext,
    toolCallId: currentToolCall.id,
    toolResultContent: lastObservation,
    isError: true,
  }
}

function getToolOutputText(result: { output?: unknown, stdout?: string, stderr?: string, exitCode?: number }): string {
  if (typeof result.output === 'string') {
    return result.output
  }
  if (result.output !== undefined) {
    const text = JSON.stringify(result.output)
    if (text.length > 0) {
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

export function createInvalidToolArgsResult(options: {
  config: AgentRuntimeConfig
  conversationId: string
  requestedToolCall: { toolName: string, input: Record<string, unknown>, invalidArgsError?: string }
  currentModelText: string
  currentToolMessages: McpToolCall[]
}): {
  lastToolCallContext: ToolCallContext
  toolCallId: string
  toolResultContent: string
  isError: boolean
} {
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
