import type { AgentTaskResult, ApprovePendingActionOptions, CancelTaskOptions, IpcResponse, RejectPendingActionOptions, StartAgentTaskOptions } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { agentRuntime } from '@main/agent/runtime/agentRuntime'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class AgentIpcService extends IpcService {
  static readonly groupName = 'agent'

  @IpcMethod()
  async startTask(options: StartAgentTaskOptions): Promise<IpcResponse<AgentTaskResult>> {
    try {
      const data = await agentRuntime.startTask(options)
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
}
