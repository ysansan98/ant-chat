import type { AgentRuntimeConfig, AgentToolResult, McpToolCall, SecretRef, ToolCallContent } from '@ant-chat/shared'
import type { RuntimeTask } from '../taskStore'
import type { PreparedToolCall, ToolRegistry } from './toolRegistry'
import type { BeforeToolExecuteHook, ToolCallContext } from './types'
import { randomUUID } from 'node:crypto'
import { AGENT_TOOL_EXEC_FAILED } from '@ant-chat/shared'
import { createAgentTraceLogger } from '../agentTraceLogger'

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
    | { kind: 'error', error: string, toolResultText: string, lastToolCallContext: ToolCallContext }

interface ToolExecutionOutcome {
  result: AgentToolResult
  failureReason?: string
}

// ============================================================
// Orchestrator
// ============================================================

export async function executeToolStep(options: ExecuteToolStepOptions): Promise<ExecuteToolStepResult> {
  const { task, registry, requestedToolCall, currentModelText, currentToolMessages, step, config } = options
  const traceLogger = createAgentTraceLogger(config)
  const toolStartedAt = Date.now()

  const prepared = registry.prepare(requestedToolCall.toolName, requestedToolCall.input)
  const currentToolCall = registerPendingToolCall(requestedToolCall, prepared, currentToolMessages)
  const logContext = createToolLogContext(task, step, currentToolCall.id)
  traceLogger.write('tool_call_received', { ...logContext, toolName: requestedToolCall.toolName, input: requestedToolCall.input })
  await emitTurnToolCalls(config, task.snapshot.conversationId, currentModelText, currentToolMessages)

  // Phase 1: Prepare — validate args and check policy
  const preparation = await prepareToolStep({
    task,
    prepared,
    requestedToolCall,
    currentToolCall,
    step,
    config,
    beforeToolExecute: options.beforeToolExecute,
    onToolCallContext: options.onToolCallContext,
    toolStartedAt,
  })

  if (preparation.kind === 'error') {
    return finalizeToolStep(currentToolCall, preparation, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  // Abort check between prepare and execute
  if (options.abortSignal?.aborted) {
    const durationMs = Date.now() - toolStartedAt
    traceLogger.write('tool_cancelled', { ...logContext, toolName: requestedToolCall.toolName, durationMs })
    return finalizeToolStep(currentToolCall, {
      kind: 'error',
      error: 'AGENT_CANCELLED',
      toolResultText: '任务已取消。',
      lastToolCallContext: preparation.lastToolCallContext,
    }, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  // Phase 2: Execute
  const execution = await executePreparedTool(preparation.prepared, task, config)

  // Phase 3: Finalize
  const durationMs = Date.now() - toolStartedAt
  if (execution.failureReason) {
    const toolReportedDurationMs = execution.result.diagnostics?.durationMs
    traceLogger.write('tool_failed', { ...logContext, toolName: preparation.prepared.toolName, input: requestedToolCall.input, error: execution.failureReason, workspacePath: task.snapshot.workspacePath, stdout: execution.result.diagnostics?.stdout, stderr: execution.result.diagnostics?.stderr, exitCode: execution.result.diagnostics?.exitCode, durationMs, toolReportedDurationMs })
    return finalizeToolStep(currentToolCall, {
      kind: 'error',
      error: execution.failureReason,
      toolResultText: execution.result.result,
      lastToolCallContext: preparation.lastToolCallContext,
    }, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  return finalizeSuccessToolStep(currentToolCall, preparation, execution.result, logContext, config, currentModelText, currentToolMessages, durationMs)
}

// ============================================================
// Phase 1: Prepare — resolve tool, validate, call hook
// ============================================================

interface PrepareToolStepInput {
  task: RuntimeTask
  prepared: ReturnType<ToolRegistry['prepare']>
  requestedToolCall: RequestedToolCall
  currentToolCall: McpToolCall
  step: number
  config: AgentRuntimeConfig
  beforeToolExecute: BeforeToolExecuteHook
  onToolCallContext?: (context: ToolCallContext) => void
  toolStartedAt: number
}

async function prepareToolStep(input: PrepareToolStepInput): Promise<ToolPreparation> {
  const { task, prepared, requestedToolCall, currentToolCall, step, config, beforeToolExecute, onToolCallContext, toolStartedAt } = input
  const traceLogger = createAgentTraceLogger(config)

  let lastToolCallContext: ToolCallContext = {
    toolName: requestedToolCall.toolName,
    input: requestedToolCall.input,
    operationType: prepared.operationType,
    scope: prepared.scope,
    policy: 'unknown',
  }

  if (prepared.validationError) {
    const logContext = createToolLogContext(task, step, currentToolCall.id)
    const durationMs = Date.now() - toolStartedAt
    traceLogger.write('tool_failed', { ...logContext, toolName: prepared.toolName, input: requestedToolCall.input, error: prepared.validationError, workspacePath: task.snapshot.workspacePath, durationMs })
    return {
      kind: 'error',
      error: prepared.validationError,
      toolResultText: prepared.validationError,
      lastToolCallContext,
    }
  }

  const beforeResult = await beforeToolExecute({
    task,
    prepared: prepared as PreparedToolCall,
    config,
    step,
    toolCallId: currentToolCall.id,
    onToolCallContext: (context) => {
      lastToolCallContext = context
      onToolCallContext?.(context)
    },
  })

  if (beforeResult.outcome === 'block') {
    const logContext = createToolLogContext(task, step, currentToolCall.id)
    const durationMs = Date.now() - toolStartedAt
    traceLogger.write('tool_blocked', { ...logContext, toolName: requestedToolCall.toolName, input: requestedToolCall.input, operationType: prepared.operationType, scope: prepared.scope, policy: 'block', reason: beforeResult.reason, errorCode: beforeResult.errorCode, workspacePath: task.snapshot.workspacePath, durationMs })
    return {
      kind: 'error',
      error: beforeResult.errorCode,
      toolResultText: beforeResult.reason,
      lastToolCallContext,
    }
  }

  return { kind: 'ready', prepared: prepared as PreparedToolCall, lastToolCallContext }
}

// ============================================================
// Phase 2: Execute — run the prepared tool
// ============================================================

async function executePreparedTool(prepared: PreparedToolCall, task: RuntimeTask, config: AgentRuntimeConfig): Promise<ToolExecutionOutcome> {
  let result: AgentToolResult
  try {
    result = prepared.toolName === 'requestSecret'
      ? await executeRequestSecret(prepared, task, config)
      : await prepared.execute()
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error || '工具执行失败。')
    return { result: { ok: false, result: message, diagnostics: { stderr: message } }, failureReason: AGENT_TOOL_EXEC_FAILED }
  }
  if (!result.ok) {
    return { result, failureReason: result.result || AGENT_TOOL_EXEC_FAILED }
  }
  return { result }
}

async function executeRequestSecret(prepared: PreparedToolCall, task: RuntimeTask, config: AgentRuntimeConfig): Promise<AgentToolResult> {
  if (!config.secretRequester) {
    return { ok: false, result: 'Secret requester is not available' }
  }
  const label = String(prepared.input.label || '').trim()
  const fields = Array.isArray(prepared.input.fields)
    ? prepared.input.fields.map(field => ({
        key: String((field as { key?: unknown }).key || '').trim(),
        label: String((field as { label?: unknown }).label || '').trim(),
      }))
    : undefined
  const reason = typeof prepared.input.reason === 'string' ? prepared.input.reason : undefined
  const result = await config.secretRequester.requestSecret({
    runId: task.snapshot.taskId,
    conversationId: task.snapshot.conversationId,
    label: label || (fields?.length === 1 ? fields[0].label : '敏感信息'),
    fields,
    reason,
  })
  return { ok: true, result: JSON.stringify(result) }
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
  const toolResultText = preparation.kind === 'error' ? preparation.toolResultText : ''

  currentToolCall.executeState = 'completed'
  currentToolCall.result = error
    ? { success: false, error }
    : { success: true, data: toolResultText }

  await emitTurnToolCalls(config, conversationId, currentModelText, currentToolMessages)

  return {
    lastToolCallContext: preparation.lastToolCallContext,
    toolCallId: currentToolCall.id,
    toolResultContent: toolResultText,
    isError: !!error,
  }
}

async function finalizeSuccessToolStep(
  currentToolCall: McpToolCall,
  preparation: ToolPreparation & { kind: 'ready' },
  result: ToolExecutionOutcome['result'],
  logContext: ToolLogContext,
  config: AgentRuntimeConfig,
  currentModelText: string,
  currentToolMessages: McpToolCall[],
  durationMs: number,
): Promise<ExecuteToolStepResult> {
  const { prepared, lastToolCallContext } = preparation
  const traceLogger = createAgentTraceLogger(config)

  const toolOutputText = await redactSecrets(result.result, prepared.input, config)
  const toolReportedDurationMs = result.diagnostics?.durationMs

  currentToolCall.executeState = 'completed'
  currentToolCall.result = { success: true, data: toolOutputText }

  await emitTurnToolCalls(config, logContext.conversationId, currentModelText, currentToolMessages)

  traceLogger.write('tool_completed', { ...logContext, toolName: prepared.toolName, outputPreview: toolOutputText, exitCode: result.diagnostics?.exitCode, durationMs, toolReportedDurationMs })

  return {
    lastToolCallContext,
    toolCallId: currentToolCall.id,
    toolResultContent: toolOutputText,
    isError: false,
  }
}

async function redactSecrets(text: string, input: Record<string, unknown>, config: AgentRuntimeConfig): Promise<string> {
  let next = text
  for (const ref of collectSecretRefs(input)) {
    next = next.split(ref.id).join('[secret-ref]')
    const secretValue = await config.secretStore?.resolve(ref)
    if (secretValue) {
      next = next.split(secretValue).join('[secret]')
    }
  }
  return next
}

function collectSecretRefs(value: unknown): SecretRef[] {
  if (isSecretRef(value)) {
    return [value]
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  if (Array.isArray(value)) {
    return (value as unknown[]).flatMap(collectSecretRefs)
  }
  return Object.values(value).flatMap(collectSecretRefs)
}

function isSecretRef(value: unknown): value is SecretRef {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && (value as { kind?: unknown }).kind === 'secret_ref'
    && typeof (value as { id?: unknown }).id === 'string'
    && ((value as { scope?: unknown }).scope === 'persistent' || (value as { scope?: unknown }).scope === 'turn')
}

// ============================================================
// Helpers
// ============================================================

interface ToolLogContext {
  runId: string
  taskId: string
  conversationId: string
  userMessageId: string
  step: number
  toolCallId: string
}

function createToolLogContext(task: RuntimeTask, step: number, toolCallId: string): ToolLogContext {
  return {
    runId: task.snapshot.taskId,
    taskId: task.snapshot.taskId,
    conversationId: task.snapshot.conversationId,
    userMessageId: task.snapshot.userMessageId,
    step,
    toolCallId,
  }
}

function registerPendingToolCall(
  requestedToolCall: RequestedToolCall,
  prepared: ReturnType<ToolRegistry['prepare']>,
  currentToolMessages: McpToolCall[],
): McpToolCall {
  const call: McpToolCall = {
    id: requestedToolCall.id ?? randomUUID(),
    serverName: prepared.serverName,
    toolName: requestedToolCall.toolName,
    args: requestedToolCall.input,
    executeState: 'executing',
  }
  currentToolMessages.push(call)
  return call
}

function toToolCallContent(tool: McpToolCall): ToolCallContent {
  return {
    type: 'tool-call',
    toolCallId: tool.id,
    toolName: tool.toolName,
    args: tool.args,
    serverName: tool.serverName,
    executeState: tool.executeState === 'await' ? undefined : tool.executeState,
  }
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
    toolCalls: toolMessages.map(toToolCallContent),
  })
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
    toolCalls: currentToolMessages.map(toToolCallContent),
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
