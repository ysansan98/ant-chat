import type { AppRpcInput, AppRpcMethod, AppRpcOutput, IpcResponse } from '@ant-chat/shared'
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
      return await getAppRuntime().invoke(method, input)
    }, '执行 Runtime RPC 失败')
  }
}
