import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApprovalController } from '../approvalController'
import { TaskStore } from '../../taskStore'
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
    pendingSteeringMessages: [],
    pendingResolver: undefined as ((value: { approved: boolean, reason?: string }) => void) | undefined,
  }
}

describe('createApprovalController 行为', () => {
  let emitter: IAgentEventEmitter
  let taskStore: TaskStore

  function cleanupTasks(taskIds: string[]) {
    for (const id of taskIds) {
      taskStore.finish(id)
    }
  }

  beforeEach(() => {
    emitter = createMockEmitter()
    taskStore = new TaskStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('approvePendingAction 行为', () => {
    it('批准并结束 pending resolver', async () => {
      const controller = createApprovalController(emitter, taskStore)
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

    it('未知任务抛出 AGENT_TASK_NOT_FOUND', () => {
      const controller = createApprovalController(emitter, taskStore)
      expect(() =>
        controller.approvePendingAction({ taskId: 'nonexistent', actionId: 'action-1' }),
      ).toThrow('Task not found')
    })

    it('任务未等待审批时抛出 AGENT_TASK_NOT_APPROVABLE', () => {
      const controller = createApprovalController(emitter, taskStore)
      const task = createRunningTask('t-no-approval', 'conv-no-approval')
      taskStore.create(task)

      expect(() =>
        controller.approvePendingAction({ taskId: 't-no-approval', actionId: 'action-1' }),
      ).toThrow('Task is not awaiting approval')

      cleanupTasks(['t-no-approval'])
    })

    it('actionId 错误时抛出 AGENT_APPROVAL_ACTION_MISMATCH', () => {
      const controller = createApprovalController(emitter, taskStore)
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

  describe('rejectPendingAction 行为', () => {
    it('带 reason 拒绝并结束 pending resolver', async () => {
      const controller = createApprovalController(emitter, taskStore)
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

  describe('cancelTask 行为', () => {
    it('中止任务并用 AGENT_CANCELLED 结束 pending resolver', async () => {
      const controller = createApprovalController(emitter, taskStore)
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

    it('未知任务抛出 AGENT_TASK_NOT_FOUND', () => {
      const controller = createApprovalController(emitter, taskStore)
      expect(() => controller.cancelTask({ taskId: 'nonexistent' })).toThrow('Task not found')
    })

    it('取消没有 pending action 的运行中任务', () => {
      const controller = createApprovalController(emitter, taskStore)
      const task = createRunningTask('t-cancel-running', 'conv-cancel-running')
      taskStore.create(task)

      expect(() => controller.cancelTask({ taskId: 't-cancel-running' })).not.toThrow()
      expect(task.snapshot.status).toBe('cancelled')
      expect(task.abortController.signal.aborted).toBe(true)

      cleanupTasks(['t-cancel-running'])
    })
  })

  describe('waitForApproval 行为', () => {
    it('pendingResolver 收到 approved 时 resolve', async () => {
      const controller = createApprovalController(emitter, taskStore)
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

    it('超过 APPROVAL_TIMEOUT_MS 后 reject', async () => {
      vi.useFakeTimers()
      const controller = createApprovalController(emitter, taskStore)
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

    it('已经 resolve 后超时不再 reject', async () => {
      vi.useFakeTimers()
      const controller = createApprovalController(emitter, taskStore)
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
