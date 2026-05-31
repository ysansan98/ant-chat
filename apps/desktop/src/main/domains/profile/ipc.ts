import type { AgentProfileFiles, IpcResponse, UpdateAgentProfileInput } from '@ant-chat/shared'
import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'
import { logger } from '@main/utils/logger'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class ProfileIpcService extends IpcService {
  static readonly groupName = 'profile'

  @IpcMethod()
  async getProfile(): Promise<IpcResponse<AgentProfileFiles>> {
    try {
      return createIpcResponse(true, await getAgentRuntimeEnvironment().appDataServices.profileService.readProfile())
    }
    catch (error) {
      logger.error('获取 Agent Profile 失败:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async updateProfile(input: UpdateAgentProfileInput): Promise<IpcResponse<AgentProfileFiles>> {
    try {
      return createIpcResponse(true, await getAgentRuntimeEnvironment().appDataServices.profileService.updateProfile(input))
    }
    catch (error) {
      logger.error('更新 Agent Profile 失败:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }

  @IpcMethod()
  async rollbackSoul(): Promise<IpcResponse<AgentProfileFiles>> {
    try {
      return createIpcResponse(true, await getAgentRuntimeEnvironment().appDataServices.profileService.rollbackSoul())
    }
    catch (error) {
      logger.error('回滚 SOUL.md 失败:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  }
}
