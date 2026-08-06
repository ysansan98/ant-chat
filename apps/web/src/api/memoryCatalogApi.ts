import type { MemoryRecord, MemoryStatus } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export const memoryCatalogApi = {
  async list(status?: MemoryStatus) {
    return getAppRpcClient().call('memoryCatalog.list', status === undefined ? undefined : { status })
  },

  async getBody(memoryId: string) {
    return getAppRpcClient().call('memoryCatalog.getBody', { memoryId })
  },

  async approve(memoryId: string): Promise<MemoryRecord> {
    return getAppRpcClient().call('memoryCatalog.approve', { memoryId })
  },

  async archive(memoryId: string): Promise<MemoryRecord> {
    return getAppRpcClient().call('memoryCatalog.archive', { memoryId })
  },
}
