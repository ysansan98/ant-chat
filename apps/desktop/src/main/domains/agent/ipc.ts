import type { AgentTurnResult, ApprovePendingActionOptions, CancelTaskOptions, IpcResponse, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class AgentIpcService extends IpcService {
  static readonly groupName = 'agent'

  @IpcMethod()
  async startTurn(options: StartAgentTurnOptions): Promise<IpcResponse<AgentTurnResult>> {
    try {
      const data = await getAgentRuntimeEnvironment().agentService.startTurn(options)
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async approvePendingAction(options: ApprovePendingActionOptions): Promise<IpcResponse<null>> {
    try {
      getAgentRuntimeEnvironment().runtime.approvePendingAction(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async rejectPendingAction(options: RejectPendingActionOptions): Promise<IpcResponse<null>> {
    try {
      getAgentRuntimeEnvironment().runtime.rejectPendingAction(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async cancelTask(options: CancelTaskOptions): Promise<IpcResponse<null>> {
    try {
      getAgentRuntimeEnvironment().runtime.cancelTask(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async getTask(taskId: string) {
    try {
      return createIpcResponse(true, getAgentRuntimeEnvironment().runtime.getTask(taskId))
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async listActiveTasks(conversationId?: string) {
    try {
      return createIpcResponse(true, getAgentRuntimeEnvironment().runtime.listActiveTasks(conversationId))
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async injectSteering(params: { conversationId: string, text: string }): Promise<IpcResponse<null>> {
    try {
      await getAgentRuntimeEnvironment().runtime.injectSteering(params.conversationId, params.text)
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
      getAgentRuntimeEnvironment().agentService.approvePendingActionWithWhitelist(options)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
