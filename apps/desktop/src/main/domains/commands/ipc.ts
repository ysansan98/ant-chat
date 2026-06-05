import type { IpcResponse, RunBuiltinCommandParams, RunBuiltinCommandResult } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class CommandsIpcService extends IpcService {
  static readonly groupName = 'commands'

  @IpcMethod()
  async runBuiltinCommand(params: RunBuiltinCommandParams): Promise<IpcResponse<RunBuiltinCommandResult>> {
    try {
      const data = await getAgentRuntimeEnvironment().commandController.runBuiltinCommand(params)
      return createIpcResponse(true, data)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }

  @IpcMethod()
  async cancelCommand(conversationId: string): Promise<IpcResponse<null>> {
    try {
      await getAgentRuntimeEnvironment().commandController.cancelCommand(conversationId)
      return createIpcResponse(true, null)
    }
    catch (error) {
      return createErrorIpcResponse(error as Error)
    }
  }
}
