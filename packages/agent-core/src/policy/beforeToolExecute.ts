import type { AgentPendingAction, ToolApprovalWhitelistEntry } from '@ant-chat/shared'
import type { RuntimeTask } from '../taskStore'
import type { BeforeToolExecuteHook } from '../tools/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from '../AgentError'
import { getAgentLogger } from '../logger'
import { decidePolicy } from './policyEngine'
import { extractInputKey, generatePattern, isWhitelisted } from './toolApprovalWhitelist'

export function createBeforeToolExecuteHook(
  waitForApproval: (task: RuntimeTask) => Promise<{ approved: boolean, reason?: string }>,
  getWhitelistEntries?: () => ToolApprovalWhitelistEntry[],
): BeforeToolExecuteHook {
  return async (input) => {
    const { task, prepared, config, onToolCallContext } = input
    const logger = getAgentLogger(config)
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

    const context = {
      toolName: prepared.toolName,
      input: prepared.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: policyDecision.type,
    }
    onToolCallContext?.(context)

    logger.info('agent-runtime', {
      event: 'tool_decision',
      ...logContext,
      toolName: prepared.toolName,
      input: prepared.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: policyDecision.type,
      workspacePath: task.snapshot.workspacePath,
    })
    config.taskLogger?.write('tool_decision', {
      ...logContext,
      toolName: prepared.toolName,
      input: prepared.input,
      operationType: prepared.operationType,
      scope: prepared.scope,
      policy: policyDecision.type,
      workspacePath: task.snapshot.workspacePath,
    })

    if (policyDecision.type === 'allow') {
      return { outcome: 'allow' }
    }

    if (policyDecision.type === 'block') {
      logger.info('agent-runtime', {
        event: 'tool_blocked',
        ...logContext,
        toolName: prepared.toolName,
        input: prepared.input,
        operationType: prepared.operationType,
        scope: prepared.scope,
        policy: policyDecision.type,
        reason: policyDecision.reason,
        errorCode: policyDecision.errorCode,
        workspacePath: task.snapshot.workspacePath,
      })
      config.taskLogger?.write('tool_blocked', {
        ...logContext,
        toolName: prepared.toolName,
        input: prepared.input,
        operationType: prepared.operationType,
        scope: prepared.scope,
        policy: policyDecision.type,
        reason: policyDecision.reason,
        errorCode: policyDecision.errorCode,
        workspacePath: task.snapshot.workspacePath,
      })
      return {
        outcome: 'block',
        errorCode: policyDecision.errorCode,
        reason: policyDecision.reason,
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
        logger.info('agent-runtime', {
          event: 'tool_whitelist_auto_approved',
          ...logContext,
          toolName: prepared.toolName,
          scope: prepared.scope,
          matchKey,
          pattern: matched.pattern,
          workspacePath: task.snapshot.workspacePath,
        })
        config.taskLogger?.write('tool_whitelist_auto_approved', {
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
