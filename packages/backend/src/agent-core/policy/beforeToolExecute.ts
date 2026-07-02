import type { AgentPendingAction, ToolApprovalWhitelistEntry } from '@ant-chat/shared'
import type { RuntimeTask } from '../taskStore'
import type { BeforeToolExecuteHook } from '../tools/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from '../AgentError'
import { createAgentTraceLogger } from '../agentTraceLogger'
import { decidePolicy } from './policyEngine'
import { extractInputKey, generatePattern, isWhitelisted } from './toolApprovalWhitelist'

export function createBeforeToolExecuteHook(
  waitForApproval: (task: RuntimeTask) => Promise<{ approved: boolean, reason?: string }>,
  getWhitelistEntries?: () => ToolApprovalWhitelistEntry[],
): BeforeToolExecuteHook {
  return async (input) => {
    const { task, prepared, config, onToolCallContext } = input
    const traceLogger = createAgentTraceLogger(config)
    const logContext = {
      runId: task.snapshot.taskId,
      taskId: task.snapshot.taskId,
      conversationId: task.snapshot.conversationId,
      userMessageId: task.snapshot.userMessageId,
      step: input.step,
      toolCallId: input.toolCallId,
    }

    const policyDecision = decidePolicy(
      task.snapshot.mode,
      prepared.operationType,
      prepared.scope,
    )
    const automationDecision = decideAutomationPolicy(
      task.snapshot.turnSource?.type === 'automation'
        ? task.snapshot.turnSource.permissionPolicy
        : undefined,
      prepared.toolName,
      prepared.input,
      prepared.operationType,
      prepared.scope,
      task.snapshot.workspacePath,
    )
    const effectiveDecision = automationDecision ?? policyDecision

    const context = {
      toolName: prepared.toolName,
      input: prepared.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: effectiveDecision.type,
    }
    onToolCallContext?.(context)

    traceLogger.write('tool_decision', {
      ...logContext,
      toolName: prepared.toolName,
      input: prepared.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: effectiveDecision.type,
      workspacePath: task.snapshot.workspacePath,
    })

    if (effectiveDecision.type === 'allow') {
      return { outcome: 'allow' }
    }

    if (effectiveDecision.type === 'block') {
      return {
        outcome: 'block',
        errorCode: effectiveDecision.errorCode,
        reason: effectiveDecision.reason,
      }
    }

    // require_approval — check whitelist before showing dialog
    if (getWhitelistEntries) {
      const matchKey = extractInputKey(prepared.toolName, prepared.input)
      const entries = getWhitelistEntries()
      const matched = isWhitelisted(
        entries,
        prepared.toolName,
        prepared.scope,
        matchKey,
        task.snapshot.workspacePath,
      )
      if (matched) {
        traceLogger.write('tool_whitelist_auto_approved', {
          ...logContext,
          toolName: prepared.toolName,
          scope: prepared.scope,
          matchKey,
          pattern: matched.pattern,
          workspacePath: task.snapshot.workspacePath,
        })
        return { outcome: 'allow' }
      }
    }

    // require_approval
    const whitelistPattern = generatePattern(
      prepared.toolName,
      prepared.input,
      prepared.scope,
      task.snapshot.workspacePath,
    )
    const pendingAction: AgentPendingAction = {
      actionId: randomUUID(),
      toolName: prepared.toolName,
      operationType: prepared.operationType,
      scope: prepared.scope,
      inputPreview: JSON.stringify(prepared.input).slice(0, 200),
      whitelistPattern,
      createdAt: Date.now(),
    }
    task.snapshot.status = 'awaiting_approval'
    task.snapshot.pendingAction = pendingAction
    config.eventEmitter.emitTaskUpdated(task.snapshot)
    config.eventEmitter.emitApprovalRequired(
      task.snapshot.taskId,
      task.snapshot.conversationId,
      pendingAction,
    )

    const decisionResult = await waitForApproval(task)
    if (
      task.abortController.signal.aborted
      || decisionResult.reason === 'AGENT_CANCELLED'
    ) {
      throw new AgentError('AGENT_CANCELLED', 'Task cancelled')
    }

    if (!decisionResult.approved) {
      return {
        outcome: 'block',
        errorCode: decisionResult.reason || 'AGENT_APPROVAL_REJECTED',
        reason: `Tool ${prepared.toolName} rejected: ${decisionResult.reason || 'no reason given'}`,
      }
    }

    return { outcome: 'allow' }
  }
}

function decideAutomationPolicy(
  policy: import('@ant-chat/shared').AutomationPermissionPolicy | undefined,
  toolName: string,
  input: Record<string, unknown>,
  operationType: import('@ant-chat/shared').ToolOperationType,
  scope: import('@ant-chat/shared').ToolScope,
  workspacePath: string,
) {
  if (!policy)
    return undefined
  if (scope !== 'workspace')
    return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务不允许访问工作区外资源' }
  if (operationType === 'read')
    return { type: 'allow' as const }
  if (operationType === 'browser') {
    return policy.allowNetwork
      ? { type: 'allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权网络访问' }
  }
  if (operationType === 'write') {
    return policy.workspaceAccess === 'write'
      ? { type: 'allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务仅有工作区读取权限' }
  }
  if (operationType === 'skill') {
    // Skill 能力已由当前 Turn 的 ToolRegistry 最小化注入，权限层不再重复维护白名单。
    return { type: 'allow' as const }
  }
  if (operationType === 'mcp') {
    return policy.allowMcpMutations
      ? { type: 'allow' as const }
      : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权 MCP 操作' }
  }
  if (!policy.allowArbitraryCommands)
    return { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '自动化任务未授权命令执行' }
  if (policy.commandPatterns.length === 0)
    return { type: 'allow' as const }
  const matchKey = extractInputKey(toolName, input)
  const entries = policy.commandPatterns.map(pattern => ({ toolName, toolScope: scope, pattern, workspacePath }))
  return isWhitelisted(entries, toolName, scope, matchKey, workspacePath)
    ? { type: 'allow' as const }
    : { type: 'block' as const, errorCode: 'AGENT_POLICY_BLOCKED' as const, reason: '命令不在自动化任务允许范围内' }
}
