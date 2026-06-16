import type { AgentMemoryFiles, IpcResponse, UpdateAgentMemoryInput } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class MemoryIpcService extends IpcService {
  static readonly groupName = 'memory'

  @IpcMethod()
  async getMemoryFiles(): Promise<IpcResponse<AgentMemoryFiles>> {
    return withIpcResponse(() => getAppRuntime().memory.getFiles(), '获取 Agent Memory 失败')
  }

  @IpcMethod()
  async updateMemoryFiles(input: UpdateAgentMemoryInput): Promise<IpcResponse<AgentMemoryFiles>> {
    return withIpcResponse(() => getAppRuntime().memory.updateFiles(input), '更新 Agent Memory 失败')
  }

  @IpcMethod()
  async rollbackSoul(): Promise<IpcResponse<AgentMemoryFiles>> {
    return withIpcResponse(() => getAppRuntime().memory.rollbackSoul(), '回滚 SOUL.md 失败')
  }
}
