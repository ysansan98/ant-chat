import type { AgentRuntimeConfig, McpToolCall } from '@ant-chat/shared'
import type { RuntimeTask } from './taskStore'
import type { PreparedToolCall, ToolRegistry } from './toolRegistry'
import type { BeforeToolExecuteHook, ToolCallContext } from './types'
import { randomUUID } from 'node:crypto'
import { truncateText } from '../utils'

const DEFAULT_TOOL_OBSERVATION_LIMIT = 4000
const DEFAULT_TOOL_LOG_PREVIEW_LIMIT = 4000

export interface RequestedToolCall {
  toolName: string
  input: Record<string, unknown>
}

export interface ExecuteToolStepOptions {
  task: RuntimeTask
  registry: ToolRegistry
  requestedToolCall: RequestedToolCall
  currentModelText: string
  currentToolMessages: McpToolCall[]
  step: number
  config: AgentRuntimeConfig
  beforeToolExecute: BeforeToolExecuteHook
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
    beforeToolExecute,
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
  let lastToolCallContext: ToolCallContext = {
    toolName: requestedToolCall.toolName,
    input: requestedToolCall.input,
    operationType: prepared.operationType,
    scope: prepared.scope,
    policy: 'unknown',
  }

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

  // === beforeToolExecute hook: policy decision + approval (injected from policy/) ===
  const beforeResult = await beforeToolExecute({
    task,
    prepared: prepared as PreparedToolCall,
    config,
    onToolCallContext: (context) => {
      lastToolCallContext = context
      onToolCallContext?.(context)
    },
  })

  if (beforeResult.outcome === 'block') {
    config.logger.info('agent-runtime', { event: 'tool_blocked', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, step, toolName: requestedToolCall.toolName, input: requestedToolCall.input, operationType: prepared.operationType, scope: prepared.scope, policy: 'block', reason: beforeResult.reason, errorCode: beforeResult.errorCode, workspacePath: task.snapshot.workspacePath })
    return finalizeToolError(
      currentToolCall,
      beforeResult.errorCode,
      formatFailure(prepared, beforeResult.errorCode, requestedToolCall.input),
      lastToolCallContext,
      config,
      task.snapshot.conversationId,
      currentModelText,
      currentToolMessages,
    )
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
    return `Tool ${prepared.toolName} failed: ${error}\n${parts.join('\n')}`
  }
  return `Tool ${prepared.toolName} failed: ${error}`
}
