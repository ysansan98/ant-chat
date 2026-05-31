import type { AgentMemoryFiles, IpcResponse, UpdateAgentMemoryInput } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class MemoryIpcService extends IpcService {
  static readonly groupName = 'memory'

  @IpcMethod()
  async getMemoryFiles(): Promise<IpcResponse<AgentMemoryFiles>> {
    try {
      return createIpcResponse(true, await getAgentRuntimeEnvironment().appDataContext.memoryManager.readMemoryFiles())
    }
    catch (error) {
      logger.error('获取 Agent Memory 失败:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async updateMemoryFiles(input: UpdateAgentMemoryInput): Promise<IpcResponse<AgentMemoryFiles>> {
    try {
      return createIpcResponse(true, await getAgentRuntimeEnvironment().appDataContext.memoryManager.updateMemoryFiles(input))
    }
    catch (error) {
      logger.error('更新 Agent Memory 失败:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async rollbackSoul(): Promise<IpcResponse<AgentMemoryFiles>> {
    try {
      return createIpcResponse(true, await getAgentRuntimeEnvironment().appDataContext.memoryManager.rollbackSoul())
    }
    catch (error) {
      logger.error('回滚 SOUL.md 失败:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }
}
