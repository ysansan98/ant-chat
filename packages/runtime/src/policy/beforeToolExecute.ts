import type { AgentPendingAction } from '@ant-chat/shared'
import type { RuntimeTask } from '../loop/taskStore'
import type { BeforeToolExecuteHook } from '../loop/types'
import { randomUUID } from 'node:crypto'
import { AgentError } from '../AgentError'
import { decidePolicy } from './policyEngine'

export function createBeforeToolExecuteHook(
  waitForApproval: (task: RuntimeTask) => Promise<{ approved: boolean, reason?: string }>,
): BeforeToolExecuteHook {
  return async (input) => {
    const { task, prepared, config, onToolCallContext } = input

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

    config.logger.info('agent-runtime', {
      event: 'tool_decision',
      conversationId: task.snapshot.conversationId,
      userMessageId: task.snapshot.userMessageId,
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
      config.logger.info('agent-runtime', {
        event: 'tool_blocked',
        conversationId: task.snapshot.conversationId,
        userMessageId: task.snapshot.userMessageId,
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

    // require_approval
    const pendingAction: AgentPendingAction = {
      actionId: randomUUID(),
      toolName: prepared.toolName,
      operationType: prepared.operationType,
      scope: prepared.scope,
      inputPreview: JSON.stringify(prepared.input).slice(0, 200),
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
