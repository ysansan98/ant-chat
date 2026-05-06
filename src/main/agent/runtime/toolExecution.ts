import type { AgentPendingAction, McpToolCall } from '@ant-chat/shared'
import type { ToolRegistry } from '../tools/toolRegistry'
import type { RuntimeTask } from './taskStore'
import { randomUUID } from 'node:crypto'
import { decidePolicy } from '../policy/policyEngine'
import { appendAgentLog } from './agentLogger'
import { updateTaskAssistantMessage } from './agentMessageWriter'
import { waitForApproval } from './approvalController'
import { reportApprovalRequired, reportTaskState } from './progressReporter'

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
    onToolCallContext,
  } = options

  await appendAgentLog(task.snapshot.taskId, 'tool_call_received', {
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
  await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages)

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

  await appendAgentLog(task.snapshot.taskId, 'tool_decision', {
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
    await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages)
    await appendAgentLog(task.snapshot.taskId, 'tool_failed', {
      toolName: prepared.toolName,
      input: requestedToolCall.input,
      error: prepared.validationError,
      workspacePath: task.snapshot.workspacePath,
    })
    lastObservation = formatToolFailureObservation(
      prepared.toolName,
      prepared.validationError,
      requestedToolCall.input,
    )
    await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
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
    await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages)
    await appendAgentLog(task.snapshot.taskId, 'tool_blocked', {
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
    lastObservation = formatToolFailureObservation(
      prepared.toolName,
      policyDecision.errorCode,
      requestedToolCall.input,
    )
    await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
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
    reportTaskState(task.snapshot)
    reportApprovalRequired(task.snapshot.taskId, task.snapshot.conversationId, pendingAction)
    await updateTaskAssistantMessage(currentAssistantMessageId, {
      status: 'loading',
      content: [{ type: 'text', text: currentModelText }],
    })

    const decisionResult = await waitForApproval(task)
    if (task.abortController.signal.aborted || decisionResult.reason === 'AGENT_CANCELLED') {
      throw new Error('AGENT_CANCELLED')
    }

    if (!decisionResult.approved) {
      currentToolCall.executeState = 'completed'
      currentToolCall.result = {
        success: false,
        error: decisionResult.reason || 'AGENT_APPROVAL_REJECTED',
      }
      lastObservation = `工具 ${prepared.toolName} 被拒绝: ${decisionResult.reason || '无原因'}`
      await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages)
      await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
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
    await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages)
    await appendAgentLog(task.snapshot.taskId, 'tool_failed', {
      toolName: prepared.toolName,
      input: requestedToolCall.input,
      error: result.error || 'AGENT_TOOL_EXEC_FAILED',
      workspacePath: task.snapshot.workspacePath,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    })
    lastObservation = formatToolFailureObservation(
      prepared.toolName,
      result.error || 'AGENT_TOOL_EXEC_FAILED',
      requestedToolCall.input,
      result,
    )
    await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
    return {
      lastToolCallContext,
      toolCallId: currentToolCall.id,
      toolResultContent: lastObservation,
      isError: true,
    }
  }

  const toolOutputText = getToolOutputText(result)
  lastObservation = buildToolObservation(prepared.toolName, result, toolOutputText)
  currentToolCall.executeState = 'completed'
  currentToolCall.result = {
    success: true,
    data: truncateTextByTool(prepared.toolName, toolOutputText, 'log'),
  }
  await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages)
  await updateAssistantMessage(currentAssistantMessageId, currentModelText, currentToolMessages, 'success')
  await appendAgentLog(task.snapshot.taskId, 'tool_completed', {
    toolName: prepared.toolName,
    input: requestedToolCall.input,
    outputPreview: truncateTextByTool(prepared.toolName, toolOutputText, 'log'),
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
  messageId: string,
  text: string,
  toolMessages: McpToolCall[],
  status: 'loading' | 'success' = 'loading',
) {
  return updateTaskAssistantMessage(messageId, {
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

function truncateText(text: string, limit: number): string {
  if (text.length <= limit) {
    return text
  }
  return `${text.slice(0, limit)}...(truncated)`
}

function truncateTextByTool(toolName: string, text: string, target: 'observation' | 'log'): string {
  if ((toolName === 'list_dir' || toolName === 'read_file') && target === 'observation') {
    return text
  }
  const limit = target === 'observation' ? DEFAULT_TOOL_OBSERVATION_LIMIT : DEFAULT_TOOL_LOG_PREVIEW_LIMIT
  return truncateText(text, limit)
}

export function buildToolObservation(
  toolName: string,
  result: { output?: unknown, stdout?: string, stderr?: string, exitCode?: number },
  outputText: string,
): string {
  if (toolName === 'list_dir' && result.output && typeof result.output === 'object') {
    const output = result.output as {
      path?: string
      offset?: number
      limit?: number
      total?: number
      hasMore?: boolean
      items?: Array<{ name: string, type: string }>
    }
    return [
      `工具 list_dir 执行成功: path=${output.path || '.'}, offset=${output.offset || 0}, limit=${output.limit || 0}, total=${output.total || 0}, returned=${output.items?.length || 0}, hasMore=${Boolean(output.hasMore)}`,
      `输出如下：\n${truncateTextByTool(toolName, outputText, 'observation')}`,
    ].join('\n')
  }
  if (toolName === 'read_file') {
    return `工具 read_file 执行成功，输出如下：\n${outputText}`
  }
  return `工具 ${toolName} 执行成功，输出: ${truncateTextByTool(toolName, outputText, 'observation')}`
}

function formatToolFailureObservation(
  toolName: string,
  error: string,
  input: Record<string, unknown>,
  result?: { stdout?: string, stderr?: string, exitCode?: number },
): string {
  if (error.includes('AGENT_BASH_COMMAND_BLOCKED')) {
    return `工具 ${toolName} 执行失败：命令被安全策略拦截。请仅使用允许的只读命令（如 pwd、ls、cat、rg、find），不要使用 ~、重定向、管道、sudo、rm 等。原始命令=${String(input.command || '')}`
  }
  if (error.includes('AGENT_POLICY_BLOCKED')) {
    return `工具 ${toolName} 执行失败：路径越界或策略不允许。请改用当前工作区内路径，优先使用相对路径（如 .、./src、blog.html）。`
  }
  if (error.includes('READ_FILE_OFFSET_OUT_OF_RANGE')) {
    return `工具 ${toolName} 执行失败：read_file 的 offset 超出文件行数。请从更小的 offset 继续读取。`
  }
  if (result?.stderr || result?.stdout || result?.exitCode !== undefined) {
    const parts: string[] = []
    if (result.stderr)
      parts.push(`stderr:\n${result.stderr}`)
    if (result.stdout)
      parts.push(`stdout:\n${result.stdout}`)
    if (result.exitCode !== undefined)
      parts.push(`exitCode=${result.exitCode}`)
    const detail = parts.join('\n')
    return `工具 ${toolName} 执行失败：${error}\n${detail}`
  }
  return `工具 ${toolName} 执行失败：${error}`
}
