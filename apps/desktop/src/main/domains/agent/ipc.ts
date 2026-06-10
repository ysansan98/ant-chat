import type { AgentTurnResult, ApprovePendingActionOptions, CancelTaskOptions, IpcResponse, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppRuntime } from '@main/runtime/appRuntime'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class AgentIpcService extends IpcService {
  static readonly groupName = 'agent'

  @IpcMethod()
  async startTurn(options: StartAgentTurnOptions): Promise<IpcResponse<AgentTurnResult>> {
    try {
      const data = await getAppRuntime().agent.startTurn(options)
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async approvePendingAction(options: ApprovePendingActionOptions): Promise<IpcResponse<null>> {
    try {
      getAppRuntime().agent.approvePendingAction(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async rejectPendingAction(options: RejectPendingActionOptions): Promise<IpcResponse<null>> {
    try {
      getAppRuntime().agent.rejectPendingAction(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async cancelTask(options: CancelTaskOptions): Promise<IpcResponse<null>> {
    try {
      getAppRuntime().agent.cancelTask(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getTask(taskId: string) {
    try {
      return createIpcResponse(true, getAppRuntime().agent.getTask(taskId))
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async listActiveTasks(conversationId?: string) {
    try {
      return createIpcResponse(true, getAppRuntime().agent.listActiveTasks(conversationId))
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async injectSteering(params: { conversationId: string, text: string }): Promise<IpcResponse<null>> {
    try {
      await getAppRuntime().agent.injectSteering(params)
      return createIpcResponse(true, null)
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
      getAppRuntime().agent.approvePendingActionWithWhitelist(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
