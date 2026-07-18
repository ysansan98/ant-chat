import type { AgentRuntimeConfig, AgentToolResult, McpToolCall, SecretRef, ToolCallContent, VisualizationBlockTransport } from '@ant-chat/shared'
import type { RuntimeTask } from '../taskStore'
import type { PreparedToolCall, ToolRegistry } from './toolRegistry'
import type { ToolAuthorization, ToolCallContext } from './types'
import { randomUUID } from 'node:crypto'
import { AGENT_TOOL_EXEC_FAILED, VisualizationOutputBlocksSchema } from '@ant-chat/shared'
import { cancelObservation, completeObservation, failObservation, startObservationSpan } from '../observation'
import { createVisualizationToolFailureResult } from './publishVisualizationTool'

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
  beforeToolExecute: ToolAuthorization
  abortSignal?: AbortSignal
  parentSpanId?: string
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
    | { kind: 'error', status: 'failed' | 'blocked' | 'cancelled', error: string, toolResultText: string, lastToolCallContext: ToolCallContext }

interface ToolExecutionOutcome {
  result: AgentToolResult
  failureReason?: string
}

// ============================================================
// Orchestrator
// ============================================================

export async function executeToolStep(options: ExecuteToolStepOptions): Promise<ExecuteToolStepResult> {
  const { task, registry, requestedToolCall, currentModelText, currentToolMessages, step, config, beforeToolExecute: beforeToolExecuteFn, parentSpanId } = options
  const toolStartedAt = Date.now()

  const prepared = registry.prepare(requestedToolCall.toolName, requestedToolCall.input)
  const redactOpaqueRefs = createToolEvidenceRedactor(prepared.input)
  const currentToolCall = registerPendingToolCall(requestedToolCall, prepared, currentToolMessages)
  const toolSpan = startObservationSpan(config, recorder => recorder.startToolCall({
    toolCallId: currentToolCall.id,
    toolName: requestedToolCall.toolName,
    input: prepared.input,
    operationType: prepared.operationType,
    scope: prepared.scope,
    serverName: prepared.serverName,
    workspacePath: task.snapshot.workspacePath,
    step,
  }, options.parentSpanId))
  await emitTurnToolCalls(config, task.snapshot.conversationId, currentModelText, currentToolMessages)

  // Phase 1: Prepare — validate args and check policy
  let preparation: ToolPreparation
  try {
    preparation = await prepareToolStep({
      task,
      prepared,
      requestedToolCall,
      currentToolCall,
      step,
      config,
      beforeToolExecute: beforeToolExecuteFn,
      parentSpanId,
    })
  }
  catch (error) {
    if (options.abortSignal?.aborted || task.abortController.signal.aborted)
      cancelObservation(toolSpan, error, config.logger)
    else
      failObservation(toolSpan, error, config.logger)
    throw error
  }

  if (preparation.kind === 'error') {
    const safePreparation = redactPreparation(preparation, redactOpaqueRefs)
    const evidence = { status: safePreparation.status, error: safePreparation.error, durationMs: Date.now() - toolStartedAt }
    if (preparation.status === 'blocked')
      completeObservation(toolSpan, evidence, config.logger)
    else
      failObservation(toolSpan, evidence, config.logger)
    return finalizeToolStep(currentToolCall, safePreparation, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  // Abort check between prepare and execute
  if (options.abortSignal?.aborted) {
    const durationMs = Date.now() - toolStartedAt
    cancelObservation(toolSpan, { status: 'cancelled', durationMs }, config.logger)
    return finalizeToolStep(currentToolCall, {
      kind: 'error',
      status: 'cancelled',
      error: 'AGENT_CANCELLED',
      toolResultText: '任务已取消。',
      lastToolCallContext: preparation.lastToolCallContext,
    }, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  // Phase 2: Execute
  const execution = await executePreparedTool(preparation.prepared, task, config)

  // Phase 3: Finalize
  const durationMs = Date.now() - toolStartedAt
  const redactEvidence = createToolEvidenceRedactor(prepared.input, prepared.resolvedSecretValues)
  if (execution.failureReason) {
    const safeFailureReason = redactEvidence(execution.failureReason)
    const safeResult = redactEvidence(execution.result.result)
    const safeDiagnostics = redactEvidence(execution.result.diagnostics)
    failObservation(toolSpan, { status: 'failed', error: safeFailureReason, output: safeResult, diagnostics: safeDiagnostics, exitCode: execution.result.diagnostics?.exitCode, durationMs }, config.logger)
    return finalizeToolStep(currentToolCall, {
      kind: 'error',
      status: 'failed',
      error: safeFailureReason,
      toolResultText: safeResult,
      lastToolCallContext: preparation.lastToolCallContext,
    }, task.snapshot.conversationId, config, currentModelText, currentToolMessages)
  }

  return finalizeSuccessToolStep(currentToolCall, preparation, execution.result, toolSpan, task.snapshot.conversationId, config, currentModelText, currentToolMessages, durationMs, redactEvidence)
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
  beforeToolExecute: ToolAuthorization
  parentSpanId?: string
}

async function prepareToolStep(input: PrepareToolStepInput): Promise<ToolPreparation> {
  const { task, prepared, requestedToolCall, currentToolCall, step, config, beforeToolExecute, parentSpanId } = input

  let lastToolCallContext: ToolCallContext = {
    toolName: requestedToolCall.toolName,
    input: prepared.input,
    operationType: prepared.operationType,
    scope: prepared.scope,
    policy: 'unknown',
  }

  if (prepared.validationError) {
    return {
      kind: 'error',
      status: 'failed',
      error: prepared.validationError,
      toolResultText: formatToolFailureResult(prepared.toolName, prepared.validationError),
      lastToolCallContext,
    }
  }

  const beforeResult = await beforeToolExecute({
    task,
    prepared: prepared as PreparedToolCall,
    config,
    step,
    toolCallId: currentToolCall.id,
    parentSpanId,
  })
  lastToolCallContext = { ...lastToolCallContext, policy: beforeResult.outcome }

  if (beforeResult.outcome === 'block') {
    return {
      kind: 'error',
      status: 'blocked',
      error: beforeResult.errorCode,
      toolResultText: formatToolFailureResult(prepared.toolName, beforeResult.reason),
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
    return {
      result: { ok: false, result: formatToolFailureResult(prepared.toolName, message), diagnostics: { stderr: message } },
      failureReason: AGENT_TOOL_EXEC_FAILED,
    }
  }
  if (!result.ok) {
    return {
      result: { ...result, result: formatToolFailureResult(prepared.toolName, result.result) },
      failureReason: result.result || AGENT_TOOL_EXEC_FAILED,
    }
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
  toolSpan: import('@ant-chat/shared').AgentObservationSpan | undefined,
  conversationId: string,
  config: AgentRuntimeConfig,
  currentModelText: string,
  currentToolMessages: McpToolCall[],
  durationMs: number,
  redactEvidence: ToolEvidenceRedactor,
): Promise<ExecuteToolStepResult> {
  const { prepared, lastToolCallContext } = preparation
  const toolOutputText = redactEvidence(result.result)
  const outputBlocks = prepared.toolName === 'publish_visualization'
    ? extractVisualizationOutputBlocks(result.diagnostics?.data)
    : []
  if (outputBlocks.length > 0) {
    currentToolCall.outputBlocks = outputBlocks
  }
  const toolReportedDurationMs = result.diagnostics?.durationMs

  currentToolCall.executeState = 'completed'
  currentToolCall.result = { success: true, data: toolOutputText }

  await emitTurnToolCalls(config, conversationId, currentModelText, currentToolMessages)
  completeObservation(toolSpan, { output: toolOutputText, diagnostics: redactEvidence(result.diagnostics), exitCode: result.diagnostics?.exitCode, durationMs, toolReportedDurationMs }, config.logger)

  return {
    lastToolCallContext,
    toolCallId: currentToolCall.id,
    toolResultContent: toolOutputText,
    isError: false,
  }
}

type ToolEvidenceRedactor = <T>(value: T) => T

function createToolEvidenceRedactor(input: Record<string, unknown>, resolvedSecretValues: string[] = []): ToolEvidenceRedactor {
  const refs = collectSecretRefs(input)
  const replacements: Array<{ value: string, marker: string }> = refs
    .filter(ref => ref.id.length > 0)
    .map(ref => ({ value: ref.id, marker: '[secret-ref]' }))

  for (const value of resolvedSecretValues.filter(Boolean))
    replacements.push({ value, marker: '[secret]' })
  replacements.sort((left, right) => right.value.length - left.value.length)

  return <T>(value: T): T => redactToolEvidenceValue(value, replacements, new WeakSet<object>()) as T
}

function redactToolEvidenceValue(
  value: unknown,
  replacements: Array<{ value: string, marker: string }>,
  ancestors: WeakSet<object>,
): unknown {
  if (typeof value === 'string') {
    return replacements.reduce(
      (text, replacement) => text.split(replacement.value).join(replacement.marker),
      value,
    )
  }
  if (!value || typeof value !== 'object')
    return value
  if (ancestors.has(value))
    return '[circular]'

  ancestors.add(value)
  try {
    if (Array.isArray(value))
      return value.map(item => redactToolEvidenceValue(item, replacements, ancestors))

    if (value instanceof Error) {
      const error = value as Error & { cause?: unknown }
      const result: Record<string, unknown> = {
        name: redactToolEvidenceValue(error.name, replacements, ancestors),
        message: redactToolEvidenceValue(error.message, replacements, ancestors),
        stack: redactToolEvidenceValue(error.stack, replacements, ancestors),
        cause: redactToolEvidenceValue(error.cause, replacements, ancestors),
      }
      for (const [key, child] of Object.entries(error)) {
        if (key === 'cause')
          continue
        result[key] = redactToolEvidenceValue(child, replacements, ancestors)
      }
      return result
    }

    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value))
      result[key] = redactToolEvidenceValue(child, replacements, ancestors)
    return result
  }
  finally {
    ancestors.delete(value)
  }
}

function collectSecretRefs(value: unknown, visited = new WeakSet<object>()): SecretRef[] {
  if (isSecretRef(value)) {
    return [value]
  }
  if (!value || typeof value !== 'object') {
    return []
  }
  if (visited.has(value))
    return []
  visited.add(value)
  if (Array.isArray(value)) {
    return (value as unknown[]).flatMap(item => collectSecretRefs(item, visited))
  }
  return Object.values(value).flatMap(item => collectSecretRefs(item, visited))
}

function redactPreparation(
  preparation: ToolPreparation & { kind: 'error' },
  redactEvidence: ToolEvidenceRedactor,
): ToolPreparation & { kind: 'error' } {
  return {
    ...preparation,
    error: redactEvidence(preparation.error),
    toolResultText: redactEvidence(preparation.toolResultText),
  }
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

function registerPendingToolCall(
  requestedToolCall: RequestedToolCall,
  prepared: ReturnType<ToolRegistry['prepare']>,
  currentToolMessages: McpToolCall[],
): McpToolCall {
  const call: McpToolCall = {
    id: requestedToolCall.id ?? randomUUID(),
    serverName: prepared.serverName,
    toolName: requestedToolCall.toolName,
    args: prepared.input,
    executeState: 'executing',
  }
  currentToolMessages.push(call)
  return call
}

function toToolCallContent(tool: McpToolCall): ToolCallContent {
  const outputBlocks = tool.outputBlocks
  return {
    type: 'tool-call',
    toolCallId: tool.id,
    toolName: tool.toolName,
    args: tool.args,
    serverName: tool.serverName,
    executeState: tool.executeState === 'await' ? undefined : tool.executeState,
    ...(outputBlocks?.length ? { outputBlocks } : {}),
  }
}

function extractVisualizationOutputBlocks(value: unknown): VisualizationBlockTransport[] {
  const parsed = VisualizationOutputBlocksSchema.safeParse(value)
  return parsed.success ? parsed.data.outputBlocks : []
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
  step?: number
  parentSpanId?: string
}): Promise<{
  lastToolCallContext: ToolCallContext
  toolCallId: string
  toolResultContent: string
  isError: boolean
}> {
  const { config, conversationId, requestedToolCall, currentModelText, currentToolMessages } = options
  const toolCallId = requestedToolCall.id ?? randomUUID()
  const error = `Tool ${requestedToolCall.toolName} argument error: ${requestedToolCall.invalidArgsError || 'args must be a JSON object'}. Fix the arguments and retry.`
  const toolSpan = startObservationSpan(config, recorder => recorder.startToolCall({
    toolCallId,
    toolName: requestedToolCall.toolName,
    input: requestedToolCall.input,
    step: options.step,
  }, options.parentSpanId))
  failObservation(toolSpan, { status: 'failed', error }, config.logger)
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
    toolResultContent: formatToolFailureResult(requestedToolCall.toolName, error),
    isError: true,
  }
}

function formatToolFailureResult(toolName: string, message: string): string {
  return toolName === 'publish_visualization' ? createVisualizationToolFailureResult(message) : message
}
