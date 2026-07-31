import type { AppRpcInput, AppRpcMethod, AppRpcOutput, IpcResponse } from '@ant-chat/shared'
import { getAppRuntime, isDesktopAppRuntimeShuttingDown } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class RuntimeIpcService extends IpcService {
  static readonly groupName = 'runtime'

  @IpcMethod()
  async call<TMethod extends AppRpcMethod>(
    method: TMethod,
    input: AppRpcInput<TMethod>,
  ): Promise<IpcResponse<AppRpcOutput<TMethod>>> {
    // 关闭过程中 runtime 已不可用，此时 RPC 失败是退出流程的预期噪音，不记 error 日志
    const shuttingDown = isDesktopAppRuntimeShuttingDown()
    return withIpcResponse(async () => {
      return await getAppRuntime().invoke(method, input)
    }, shuttingDown ? undefined : '执行 Runtime RPC 失败')
  }
}
