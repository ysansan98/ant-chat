import type { AppRpcInput, AppRpcMethod, AppRpcOutput, IpcResponse } from '@ant-chat/shared'
import { createAppRpcHandlers } from '@ant-chat/backend/rpc-handlers'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class RuntimeIpcService extends IpcService {
  static readonly groupName = 'runtime'

  @IpcMethod()
  async call<TMethod extends AppRpcMethod>(
    method: TMethod,
    input: AppRpcInput<TMethod>,
  ): Promise<IpcResponse<AppRpcOutput<TMethod>>> {
    return withIpcResponse(async () => {
      const handlers = createAppRpcHandlers(getAppRuntime())
      const handler = handlers[method]

      if (!handler) {
        throw new Error(`Unknown runtime RPC method: ${method}`)
      }

      return await handler(input as never) as AppRpcOutput<TMethod>
    }, '执行 Runtime RPC 失败')
  }
}
