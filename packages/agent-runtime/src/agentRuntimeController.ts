import type { AgentRuntime } from '@ant-chat/agent-core'
import type { AppDataContext } from '@ant-chat/app-data'
import type { AgentRuntimeStartTaskResult, ApprovePendingActionOptions, CancelTaskOptions, IMessage, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import type { AgentTurnServiceDeps } from './agentTurnService'
import { createAgentTurnService } from './agentTurnService'

export interface AgentRuntimeController {
  startTurn: (options: StartAgentTurnOptions) => Promise<AgentRuntimeStartTaskResult>
  approvePendingAction: (options: ApprovePendingActionOptions) => null
  rejectPendingAction: (options: RejectPendingActionOptions) => null
  cancelTask: (options: CancelTaskOptions) => null
  injectSteering: (params: { conversationId: string, text: string }) => Promise<IMessage>
  listActiveTasks: (conversationId?: string) => ReturnType<AgentRuntime['listActiveTasks']>
  approvePendingActionWithWhitelist: (options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string }) => null
}

export function createAgentRuntimeController(
  runtime: AgentRuntime,
  appDataContext: AppDataContext,
  turnServiceDeps: Omit<AgentTurnServiceDeps, 'runtime' | 'appDataContext'> = {},
): AgentRuntimeController {
  const turnService = createAgentTurnService({
    runtime,
    appDataContext,
    ...turnServiceDeps,
  })

  return {
    async startTurn(options) {
      return await turnService.startTurn(options)
    },
    approvePendingAction(options) {
      runtime.approvePendingAction(options)
      return null
    },
    rejectPendingAction(options) {
      runtime.rejectPendingAction(options)
      return null
    },
    cancelTask(options) {
      runtime.cancelTask(options)
      return null
    },
    async injectSteering(params) {
      return await runtime.injectSteering(params.conversationId, params.text)
    },
    listActiveTasks(conversationId) {
      return runtime.listActiveTasks(conversationId)
    },
    approvePendingActionWithWhitelist(options) {
      if (options.remember) {
        const snapshot = runtime.getTask(options.taskId)
        const pending = snapshot.pendingAction
        if (pending?.whitelistPattern) {
          appDataContext.toolApprovalWhitelistRepository.add({
            toolName: pending.toolName,
            toolScope: pending.scope,
            pattern: pending.whitelistPattern,
            workspacePath: options.workspacePath,
          })
        }
      }

      runtime.approvePendingAction(options)
      return null
    },
  }
}
