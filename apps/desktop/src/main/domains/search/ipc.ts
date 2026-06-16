import type { IpcResponse, SearchResult } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SearchIpcService extends IpcService {
  static readonly groupName = 'search'

  @IpcMethod()
  async searchByKeyword(query: string): Promise<IpcResponse<SearchResult[]>> {
    return withIpcResponse(() => getAppRuntime().search.messages(query), '全局搜索消息失败')
  }
}
