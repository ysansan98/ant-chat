import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApprovalController } from '../approvalController'
import { taskStore } from '../../taskStore'
import type { AgentTaskSnapshot, AgentTaskStatus, IAgentEventEmitter } from '@ant-chat/shared'

function createMockEmitter(): IAgentEventEmitter {
  return {
    emitTaskUpdated: vi.fn(),
    emitApprovalRequired: vi.fn(),
    emitTurnStarted: vi.fn(),
    emitTurnChunk: vi.fn(),
    emitTurnToolCalls: vi.fn(),
    emitTurnFinished: vi.fn(),
  }
}

function createRunningTask(taskId: string, conversationId: string) {
  return {
    snapshot: {
      taskId,
      conversationId,
      userMessageId: `msg-${taskId}`,
      workspacePath: '/workspace',
      mode: 'hybrid' as const,
      status: 'running' as AgentTaskStatus,
      prompt: 'test',
      createdAt: 1000,
      updatedAt: 1000,
      logPath: '',
      pendingAction: undefined,
    } as AgentTaskSnapshot,
    abortController: new AbortController(),
    steeringQueue: [],
    pendingResolver: undefined as ((value: { approved: boolean, reason?: string }) => void) | undefined,
  }
}

// Helper: clean taskStore by finishing all known test tasks
function cleanupTasks(taskIds: string[]) {
  for (const id of taskIds) {
    try {
      taskStore.finish(id)
    }
    catch {}
    try {
      taskStore.delete(id)
    }
    catch {}
  }
}

describe('createApprovalController', () => {
  let emitter: IAgentEventEmitter

  beforeEach(() => {
    emitter = createMockEmitter()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('approvePendingAction', () => {
    it('approves and resolves the pending resolver', async () => {
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-approve-1', 'conv-approve-1')
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = {
        actionId: 'action-1',
        toolName: 'bash',
        operationType: 'bash',
        scope: 'workspace',
        inputPreview: '{}',
        createdAt: Date.now(),
      }
      taskStore.create(task)

      const approvalPromise = controller.waitForApproval(task)
      controller.approvePendingAction({ taskId: 't-approve-1', actionId: 'action-1' })

      const result = await approvalPromise
      expect(result).toEqual({ approved: true })
      expect(task.snapshot.status).toBe('running')
      expect(task.snapshot.pendingAction).toBeUndefined()
      expect(emitter.emitTaskUpdated).toHaveBeenCalledWith(task.snapshot)

      cleanupTasks(['t-approve-1'])
    })

    it('throws AGENT_TASK_NOT_FOUND for unknown task', () => {
      const controller = createApprovalController(emitter)
      expect(() =>
        controller.approvePendingAction({ taskId: 'nonexistent', actionId: 'action-1' }),
      ).toThrow('Task not found')
    })

    it('throws AGENT_TASK_NOT_APPROVABLE when task is not awaiting approval', () => {
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-no-approval', 'conv-no-approval')
      taskStore.create(task)

      expect(() =>
        controller.approvePendingAction({ taskId: 't-no-approval', actionId: 'action-1' }),
      ).toThrow('Task is not awaiting approval')

      cleanupTasks(['t-no-approval'])
    })

    it('throws AGENT_APPROVAL_ACTION_MISMATCH for wrong actionId', () => {
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-mismatch', 'conv-mismatch')
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = {
        actionId: 'action-1',
        toolName: 'bash',
        operationType: 'bash',
        scope: 'workspace',
        inputPreview: '{}',
        createdAt: Date.now(),
      }
      taskStore.create(task)

      expect(() =>
        controller.approvePendingAction({ taskId: 't-mismatch', actionId: 'wrong-action' }),
      ).toThrow('Approval action mismatch')

      cleanupTasks(['t-mismatch'])
    })
  })

  describe('rejectPendingAction', () => {
    it('rejects with reason and resolves the pending resolver', async () => {
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-reject', 'conv-reject')
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = {
        actionId: 'action-1',
        toolName: 'bash',
        operationType: 'bash',
        scope: 'workspace',
        inputPreview: '{}',
        createdAt: Date.now(),
      }
      taskStore.create(task)

      const approvalPromise = controller.waitForApproval(task)
      controller.rejectPendingAction({ taskId: 't-reject', actionId: 'action-1', reason: 'not allowed' })

      const result = await approvalPromise
      expect(result).toEqual({ approved: false, reason: 'not allowed' })
      expect(task.snapshot.status).toBe('running')
      expect(task.snapshot.pendingAction).toBeUndefined()

      cleanupTasks(['t-reject'])
    })
  })

  describe('cancelTask', () => {
    it('aborts the task and resolves pending with AGENT_CANCELLED', async () => {
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-cancel-pending', 'conv-cancel-pending')
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = {
        actionId: 'action-1',
        toolName: 'bash',
        operationType: 'bash',
        scope: 'workspace',
        inputPreview: '{}',
        createdAt: Date.now(),
      }
      taskStore.create(task)

      const approvalPromise = controller.waitForApproval(task)
      controller.cancelTask({ taskId: 't-cancel-pending' })

      const result = await approvalPromise
      expect(result).toEqual({ approved: false, reason: 'AGENT_CANCELLED' })
      expect(task.snapshot.status).toBe('cancelled')
      expect(task.abortController.signal.aborted).toBe(true)

      cleanupTasks(['t-cancel-pending'])
    })

    it('throws AGENT_TASK_NOT_FOUND for unknown task', () => {
      const controller = createApprovalController(emitter)
      expect(() => controller.cancelTask({ taskId: 'nonexistent' })).toThrow('Task not found')
    })

    it('cancels a running task without pending action', () => {
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-cancel-running', 'conv-cancel-running')
      taskStore.create(task)

      expect(() => controller.cancelTask({ taskId: 't-cancel-running' })).not.toThrow()
      expect(task.snapshot.status).toBe('cancelled')
      expect(task.abortController.signal.aborted).toBe(true)

      cleanupTasks(['t-cancel-running'])
    })
  })

  describe('waitForApproval', () => {
    it('resolves when pendingResolver is called with approved', async () => {
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-wait-approve', 'conv-wait-approve')
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = {
        actionId: 'action-1',
        toolName: 'bash',
        operationType: 'bash',
        scope: 'workspace',
        inputPreview: '{}',
        createdAt: Date.now(),
      }
      taskStore.create(task)

      // Simulate external approval
      const promise = controller.waitForApproval(task)
      task.pendingResolver?.({ approved: true })
      const result = await promise
      expect(result).toEqual({ approved: true })

      cleanupTasks(['t-wait-approve'])
    })

    it('rejects on timeout after APPROVAL_TIMEOUT_MS', async () => {
      vi.useFakeTimers()
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-timeout', 'conv-timeout')
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = {
        actionId: 'action-1',
        toolName: 'bash',
        operationType: 'bash',
        scope: 'workspace',
        inputPreview: '{}',
        createdAt: Date.now(),
      }
      taskStore.create(task)

      const promise = controller.waitForApproval(task)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1) // just past 5 minutes

      await expect(promise).rejects.toThrow('Approval timeout')
      vi.useRealTimers()

      cleanupTasks(['t-timeout'])
    })

    it('does not reject on timeout if already resolved', async () => {
      vi.useFakeTimers()
      const controller = createApprovalController(emitter)
      const task = createRunningTask('t-resolved', 'conv-resolved')
      task.snapshot.status = 'awaiting_approval'
      task.snapshot.pendingAction = {
        actionId: 'action-1',
        toolName: 'bash',
        operationType: 'bash',
        scope: 'workspace',
        inputPreview: '{}',
        createdAt: Date.now(),
      }
      taskStore.create(task)

      const promise = controller.waitForApproval(task)
      task.pendingResolver?.({ approved: true })
      await promise // should resolve before timeout
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      // no rejection should occur
      vi.useRealTimers()

      cleanupTasks(['t-resolved'])
    })
  })
})
