import type { AgentRuntimeConfig, McpToolCall } from '@ant-chat/shared'
import type { RuntimeTask } from '../taskStore'
import type { PreparedToolCall, ToolRegistry } from './toolRegistry'
import type { BeforeToolExecuteHook, ToolCallContext } from './types'
import { randomUUID } from 'node:crypto'
import { getAgentLogger } from '../logger'

export interface RequestedToolCall {
  id?: string
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
  abortSignal?: AbortSignal
}

export interface ExecuteToolStepResult {
  lastToolCallContext: ToolCallContext
  toolCallId: string
  toolResultContent: string
  isError: boolean
}

// ============================================================
// Pipeline types
// ============================================================

type ToolPreparation
  = | { kind: 'ready', prepared: PreparedToolCall, lastToolCallContext: ToolCallContext }
    | { kind: 'error', error: string, observation: string, lastToolCallContext: ToolCallContext }

interface ToolExecution {
  result: Awaited<ReturnType<PreparedToolCall['execute']>>
  errorMsg?: string
}

// ============================================================
// Orchestrator
// ============================================================

export async function executeToolStep(options: ExecuteToolStepOptions): Promise<ExecuteToolStepResult> {
  const { task, registry, requestedToolCall, currentModelText, currentToolMessages, step, config } = options
  const logger = getAgentLogger(config)

  logger.info('agent-runtime', { event: 'tool_call_received', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, step, toolName: requestedToolCall.toolName, input: requestedToolCall.input })
  config.taskLogger?.write('tool_call_received', { conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, step, toolName: requestedToolCall.toolName, input: requestedToolCall.input })

  const currentToolCall = registerPendingToolCall(requestedToolCall, registry, currentToolMessages)
  await emitTurnToolCalls(config, task.snapshot.conversationId, currentModelText, currentToolMessages)

  // Phase 1: Prepare — validate args and check policy
  const preparation = await prepareToolStep({
    task,
    registry,
    requestedToolCall,
    currentToolCall,
    step,
    config,
    beforeToolExecute: options.beforeToolExecute,
    onToolCallContext: options.onToolCallContext,
  })

  if (preparation.kind === 'error') {
    return finalizeToolStep(currentToolCall, preparation, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  // Abort check between prepare and execute
  if (options.abortSignal?.aborted) {
    logger.info('agent-runtime', { event: 'tool_cancelled', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, step, toolName: requestedToolCall.toolName })
    return finalizeToolStep(currentToolCall, {
      kind: 'error',
      error: 'AGENT_CANCELLED',
      observation: formatFailure(preparation.prepared, 'AGENT_CANCELLED', requestedToolCall.input),
      lastToolCallContext: preparation.lastToolCallContext,
    }, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  // Phase 2: Execute
  const execution = await executePreparedTool(preparation.prepared)

  // Phase 3: Finalize
  if (execution.errorMsg) {
    logger.info('agent-runtime', { event: 'tool_failed', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, toolName: preparation.prepared.toolName, input: requestedToolCall.input, error: execution.errorMsg, workspacePath: task.snapshot.workspacePath, stdout: execution.result.stdout, stderr: execution.result.stderr, exitCode: execution.result.exitCode })
    config.taskLogger?.write('tool_failed', { conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, toolName: preparation.prepared.toolName, input: requestedToolCall.input, error: execution.errorMsg, workspacePath: task.snapshot.workspacePath, stdout: execution.result.stdout, stderr: execution.result.stderr, exitCode: execution.result.exitCode })
    return finalizeToolStep(currentToolCall, {
      kind: 'error',
      error: execution.errorMsg,
      observation: formatFailure(preparation.prepared, execution.errorMsg, requestedToolCall.input, execution.result),
      lastToolCallContext: preparation.lastToolCallContext,
    }, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  return finalizeSuccessToolStep(currentToolCall, preparation, execution.result, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
}

// ============================================================
// Phase 1: Prepare — resolve tool, validate, call hook
// ============================================================

interface PrepareToolStepInput {
  task: RuntimeTask
  registry: ToolRegistry
  requestedToolCall: RequestedToolCall
  currentToolCall: McpToolCall
  step: number
  config: AgentRuntimeConfig
  beforeToolExecute: BeforeToolExecuteHook
  onToolCallContext?: (context: ToolCallContext) => void
}

async function prepareToolStep(input: PrepareToolStepInput): Promise<ToolPreparation> {
  const { task, registry, requestedToolCall, step, config, beforeToolExecute, onToolCallContext } = input
  const logger = getAgentLogger(config)

  const prepared = registry.prepare(requestedToolCall.toolName, requestedToolCall.input)

  let lastToolCallContext: ToolCallContext = {
    toolName: requestedToolCall.toolName,
    input: requestedToolCall.input,
    operationType: prepared.operationType,
    scope: prepared.scope,
    policy: 'unknown',
  }

  if (prepared.validationError) {
    logger.info('agent-runtime', { event: 'tool_failed', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, toolName: prepared.toolName, input: requestedToolCall.input, error: prepared.validationError, workspacePath: task.snapshot.workspacePath })
    config.taskLogger?.write('tool_failed', { conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, toolName: prepared.toolName, input: requestedToolCall.input, error: prepared.validationError, workspacePath: task.snapshot.workspacePath })
    return {
      kind: 'error',
      error: prepared.validationError,
      observation: formatFailure(prepared, prepared.validationError, requestedToolCall.input),
      lastToolCallContext,
    }
  }

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
    logger.info('agent-runtime', { event: 'tool_blocked', conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, step, toolName: requestedToolCall.toolName, input: requestedToolCall.input, operationType: prepared.operationType, scope: prepared.scope, policy: 'block', reason: beforeResult.reason, errorCode: beforeResult.errorCode, workspacePath: task.snapshot.workspacePath })
    config.taskLogger?.write('tool_blocked', { conversationId: task.snapshot.conversationId, userMessageId: task.snapshot.userMessageId, step, toolName: requestedToolCall.toolName, input: requestedToolCall.input, operationType: prepared.operationType, scope: prepared.scope, policy: 'block', reason: beforeResult.reason, errorCode: beforeResult.errorCode, workspacePath: task.snapshot.workspacePath })
    return {
      kind: 'error',
      error: beforeResult.errorCode,
      observation: formatFailure(prepared, beforeResult.errorCode, requestedToolCall.input),
      lastToolCallContext,
    }
  }

  return { kind: 'ready', prepared: prepared as PreparedToolCall, lastToolCallContext }
}

// ============================================================
// Phase 2: Execute — run the prepared tool
// ============================================================

async function executePreparedTool(prepared: PreparedToolCall): Promise<ToolExecution> {
  const result = await prepared.execute()
  if (!result.ok) {
    return { result, errorMsg: result.error || 'AGENT_TOOL_EXEC_FAILED' }
  }
  return { result }
}

// ============================================================
// Phase 3: Finalize — format output, emit events, build result
// ============================================================

async function finalizeToolStep(
  currentToolCall: McpToolCall,
  preparation: ToolPreparation,
  conversationId: string,
  config: AgentRuntimeConfig,
  currentModelText: string,
  currentToolMessages: McpToolCall[],
): Promise<ExecuteToolStepResult> {
  // Both ready+error and immediate error paths converge here.
  const error = preparation.kind === 'error' ? preparation.error : undefined
  const observation = preparation.kind === 'error' ? preparation.observation : ''

  currentToolCall.executeState = 'completed'
  currentToolCall.result = error
    ? { success: false, error }
    : { success: true, data: observation }

  await emitTurnToolCalls(config, conversationId, currentModelText, currentToolMessages)

  return {
    lastToolCallContext: preparation.lastToolCallContext,
    toolCallId: currentToolCall.id,
    toolResultContent: observation,
    isError: !!error,
  }
}

async function finalizeSuccessToolStep(
  currentToolCall: McpToolCall,
  preparation: ToolPreparation & { kind: 'ready' },
  result: ToolExecution['result'],
  conversationId: string,
  config: AgentRuntimeConfig,
  currentModelText: string,
  currentToolMessages: McpToolCall[],
): Promise<ExecuteToolStepResult> {
  const { prepared, lastToolCallContext } = preparation
  const logger = getAgentLogger(config)

  const toolOutputText = getToolOutputText(result)
  const observation = buildObservation(prepared, result, toolOutputText)

  currentToolCall.executeState = 'completed'
  currentToolCall.result = { success: true, data: toolOutputText }

  await emitTurnToolCalls(config, conversationId, currentModelText, currentToolMessages)

  logger.info('agent-runtime', { event: 'tool_completed', conversationId, userMessageId: '', toolName: prepared.toolName, outputPreview: toolOutputText, exitCode: result.exitCode, durationMs: result.durationMs })
  config.taskLogger?.write('tool_completed', { conversationId, userMessageId: '', toolName: prepared.toolName, outputPreview: toolOutputText, exitCode: result.exitCode, durationMs: result.durationMs })

  return {
    lastToolCallContext,
    toolCallId: currentToolCall.id,
    toolResultContent: observation,
    isError: false,
  }
}

// ============================================================
// Helpers
// ============================================================

function registerPendingToolCall(
  requestedToolCall: RequestedToolCall,
  registry: ToolRegistry,
  currentToolMessages: McpToolCall[],
): McpToolCall {
  const prepared = registry.prepare(requestedToolCall.toolName, requestedToolCall.input)
  const call: McpToolCall = {
    id: requestedToolCall.id ?? randomUUID(),
    serverName: prepared.source,
    toolName: requestedToolCall.toolName,
    args: requestedToolCall.input,
    executeState: 'executing',
  }
  currentToolMessages.push(call)
  return call
}

async function emitTurnToolCalls(
  config: AgentRuntimeConfig,
  conversationId: string,
  text: string,
  toolMessages: McpToolCall[],
) {
  await config.eventEmitter.emitTurnToolCalls({
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
  return `Tool ${prepared.toolName} succeeded, output: ${outputText}`
}

export async function createInvalidToolArgsResult(options: {
  config: AgentRuntimeConfig
  conversationId: string
  requestedToolCall: RequestedToolCall & { invalidArgsError?: string }
  currentModelText: string
  currentToolMessages: McpToolCall[]
}): Promise<{
  lastToolCallContext: ToolCallContext
  toolCallId: string
  toolResultContent: string
  isError: boolean
}> {
  const { config, conversationId, requestedToolCall, currentModelText, currentToolMessages } = options
  const toolCallId = requestedToolCall.id ?? randomUUID()
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
  await config.eventEmitter.emitTurnToolCalls({
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
