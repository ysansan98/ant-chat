import type { UpdateAgentMemoryInput } from '@ant-chat/shared'
import { getAppRpcClient } from './transports/appRpc'

export const memoryApi = {
  async getMemoryFiles() {
    return getAppRpcClient().call('memory.getMemoryFiles', undefined)
  },

  async updateMemoryFiles(input: UpdateAgentMemoryInput) {
    return getAppRpcClient().call('memory.updateMemoryFiles', { input })
  },

  async rollbackSoul() {
    return getAppRpcClient().call('memory.rollbackSoul', undefined)
  },
}
