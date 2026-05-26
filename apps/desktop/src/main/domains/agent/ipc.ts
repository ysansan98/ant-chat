import type { AgentTurnResult, ApprovePendingActionOptions, CancelTaskOptions, IpcResponse, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { agentRuntime, startAgentTurn } from '@main/agent/runtime/agentTurnService'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class AgentIpcService extends IpcService {
  static readonly groupName = 'agent'

  @IpcMethod()
  async startTurn(options: StartAgentTurnOptions): Promise<IpcResponse<AgentTurnResult>> {
    try {
      const data = await startAgentTurn(options)
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async approvePendingAction(options: ApprovePendingActionOptions): Promise<IpcResponse<null>> {
    try {
      await agentRuntime.approvePendingAction(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async rejectPendingAction(options: RejectPendingActionOptions): Promise<IpcResponse<null>> {
    try {
      await agentRuntime.rejectPendingAction(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async cancelTask(options: CancelTaskOptions): Promise<IpcResponse<null>> {
    try {
      await agentRuntime.cancelTask(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getTask(taskId: string) {
    try {
      return createIpcResponse(true, agentRuntime.getTask(taskId))
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async listActiveTasks(conversationId?: string) {
    try {
      return createIpcResponse(true, agentRuntime.listActiveTasks(conversationId))
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async approvePendingActionWithWhitelist(
    options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string },
  ): Promise<IpcResponse<null>> {
    try {
      if (options.remember) {
        const snapshot = agentRuntime.getTask(options.taskId)
        const pending = snapshot.pendingAction
        if (pending?.whitelistPattern) {
          getAppDataServices().toolApprovalWhitelistRepository.add({
            toolName: pending.toolName,
            toolScope: pending.scope,
            pattern: pending.whitelistPattern,
            workspacePath: options.workspacePath,
          })
        }
      }
      agentRuntime.approvePendingAction(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
