import type { UpdateAgentMemoryInput } from '@ant-chat/shared'
import { getAppTransport } from './transports/appTransport'

export const memoryApi = {
  async getMemoryFiles() {
    return (await getAppTransport()).memory.getMemoryFiles()
  },

  async updateMemoryFiles(input: UpdateAgentMemoryInput) {
    return (await getAppTransport()).memory.updateMemoryFiles(input)
  },

  async rollbackSoul() {
    return (await getAppTransport()).memory.rollbackSoul()
  },
}
