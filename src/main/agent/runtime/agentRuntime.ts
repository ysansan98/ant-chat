import type { AgentTaskSnapshot, ApprovePendingActionOptions, CancelTaskOptions, RejectPendingActionOptions } from '@ant-chat/shared'
import type { AgentRuntimeStartOptions } from './types'
import { randomUUID } from 'node:crypto'
import { WorkspaceStore } from '@main/store/workspace'
import { appendAgentLog } from './agentLogger'
import { runAgentLoop } from './agentLoop'
import { approvePendingAction, cancelTask, rejectPendingAction } from './approvalController'
import { reportTaskState } from './progressReporter'
import { taskStore } from './taskStore'

class AgentRuntime {
  async startTask(options: AgentRuntimeStartOptions) {
    const missing: string[] = []
    if (!options.conversationId?.trim())
      missing.push('conversationId')
    if (!options.userMessageId?.trim())
      missing.push('userMessageId')
    if (!options.prompt?.trim())
      missing.push('prompt')
    if (missing.length > 0) {
      throw new Error(`invalid start task options: missing ${missing.join(', ')}`)
    }

    const now = Date.now()
    const taskId = randomUUID()
    const mode = options.mode ?? 'hybrid'
    const workspacePath = options.workspacePath
      ?? WorkspaceStore.getInstance().getCurrentWorkspacePath()
      ?? process.cwd()

    const snapshot: AgentTaskSnapshot = {
      taskId,
      conversationId: options.conversationId,
      userMessageId: options.userMessageId,
      workspacePath,
      mode,
      status: 'running',
      createdAt: now,
      updatedAt: now,
      checkpointPath: '',
      logPath: '',
      prompt: options.prompt,
    }

    taskStore.create({ snapshot, abortController: new AbortController() })
    snapshot.logPath = await appendAgentLog(options.conversationId, options.userMessageId, 'task_started', {
      conversationId: options.conversationId,
      userMessageId: options.userMessageId,
      mode,
      workspacePath,
    })
    reportTaskState(snapshot)
    void runAgentLoop(taskId, options).catch(() => {})

    return { taskId }
  }

  approvePendingAction(options: ApprovePendingActionOptions) {
    return approvePendingAction(options)
  }

  rejectPendingAction(options: RejectPendingActionOptions) {
    return rejectPendingAction(options)
  }

  cancelTask(options: CancelTaskOptions) {
    return cancelTask(options)
  }

  getTask(taskId: string) {
    const task = taskStore.get(taskId)
    if (!task)
      throw new Error('AGENT_TASK_NOT_FOUND')
    return task.snapshot
  }

  listActiveTasks(conversationId?: string) {
    return taskStore.listActive(conversationId)
  }
}

export const agentRuntime = new AgentRuntime()
