import type { AgentTurnResult, ApprovePendingActionOptions, CancelTaskOptions, IpcResponse, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import { getAppRuntime } from '@main/app-runtime-host/appRuntime'
import { withIpcResponse } from '@main/utils/ipc-response'
import { IpcMethod, IpcService } from 'electron-ipc-decorator'

export class AgentIpcService extends IpcService {
  static readonly groupName = 'agent'

  @IpcMethod()
  async startTurn(options: StartAgentTurnOptions): Promise<IpcResponse<AgentTurnResult>> {
    return withIpcResponse(() => getAppRuntime().agent.startTurn(options), '启动 Agent 任务失败')
  }

  @IpcMethod()
  async approvePendingAction(options: ApprovePendingActionOptions): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().agent.approvePendingAction(options), '批准 Agent 操作失败')
  }

  @IpcMethod()
  async rejectPendingAction(options: RejectPendingActionOptions): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().agent.rejectPendingAction(options), '拒绝 Agent 操作失败')
  }

  @IpcMethod()
  async cancelTask(options: CancelTaskOptions): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().agent.cancelTask(options), '取消 Agent 任务失败')
  }

  @IpcMethod()
  async getTask(taskId: string) {
    return withIpcResponse(() => getAppRuntime().agent.getTask(taskId), '获取 Agent 任务失败')
  }

  @IpcMethod()
  async listActiveTasks(conversationId?: string) {
    return withIpcResponse(() => getAppRuntime().agent.listActiveTasks(conversationId), '获取活跃任务列表失败')
  }

  @IpcMethod()
  async injectSteering(params: { conversationId: string, text: string }) {
    return withIpcResponse(() => getAppRuntime().agent.injectSteering(params), '注入引导消息失败')
  }

  @IpcMethod()
  async approvePendingActionWithWhitelist(
    options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string },
  ): Promise<IpcResponse<null>> {
    return withIpcResponse(() => getAppRuntime().agent.approvePendingActionWithWhitelist(options), '批准并加入白名单失败')
  }
}
