import type { IpcResponse, RunBuiltinCommandParams, RunBuiltinCommandResult } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class CommandsIpcService extends IpcService {
  static readonly groupName = 'commands'

  @IpcMethod()
  async runBuiltinCommand(params: RunBuiltinCommandParams): Promise<IpcResponse<RunBuiltinCommandResult>> {
    return withIpcResponse(() => getAppRuntime().commands.run(params), '执行内置命令失败')
  }

  @IpcMethod()
  async cancelCommand(conversationId: string): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().commands.cancel(conversationId), '取消命令失败')
  }
}
