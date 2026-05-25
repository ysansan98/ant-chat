import type { IpcResponse, SearchResult } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class SearchIpcService extends IpcService {
  static readonly groupName = 'search'

  @IpcMethod()
  async searchByKeyword(query: string): Promise<IpcResponse<SearchResult[]>> {
    try {
      const data = await getAppDataServices().messageSearchService.searchMessagesByKeyword(query)
      return createIpcResponse(true, data)
    }
    catch (error) {
      logger.error('全局搜索消息失败:', error)
      return createErrorIpcResponse(error as Error)
    }
  }
}
