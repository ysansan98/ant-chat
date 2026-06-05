import type { AgentRuntime } from '@ant-chat/agent-core'
import type { AppDataContext } from '@ant-chat/app-data'
import type { AgentRuntimeStartTaskOptions, AgentRuntimeStartTaskResult, ApprovePendingActionOptions, CancelTaskOptions, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import process from 'node:process'

export interface AgentRuntimeController {
  startTurn: (options: StartAgentTurnOptions) => Promise<AgentRuntimeStartTaskResult>
  approvePendingAction: (options: ApprovePendingActionOptions) => null
  rejectPendingAction: (options: RejectPendingActionOptions) => null
  cancelTask: (options: CancelTaskOptions) => null
  injectSteering: (params: { conversationId: string, text: string }) => Promise<null>
  listActiveTasks: (conversationId?: string) => ReturnType<AgentRuntime['listActiveTasks']>
  approvePendingActionWithWhitelist: (options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string }) => null
}

export function createAgentRuntimeController(runtime: AgentRuntime, appDataContext: AppDataContext): AgentRuntimeController {
  return {
    async startTurn(options) {
      return await runtime.startTask(toRuntimeStartOptions(options, appDataContext))
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
      await runtime.injectSteering(params.conversationId, params.text)
      return null
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

function toRuntimeStartOptions(
  options: StartAgentTurnOptions,
  appDataContext: AppDataContext,
): AgentRuntimeStartTaskOptions {
  const workspacePath = options.workspacePath
    ?? appDataContext.workspaceService.getCurrentWorkspacePath()
    ?? process.cwd()

  const startOptions: AgentRuntimeStartTaskOptions = {
    prompt: options.prompt,
    modelId: options.modelConfig.modelId,
    workspacePath,
    mode: options.mode ?? 'hybrid',
    modelSettings: {
      systemPrompt: options.modelConfig.systemPrompt,
      temperature: options.modelConfig.temperature,
      maxTokens: options.modelConfig.maxTokens,
    },
  }

  if (options.conversationId)
    startOptions.conversationId = options.conversationId
  if (options.content)
    startOptions.content = options.content
  if (options.referencedFiles)
    startOptions.referencedFiles = options.referencedFiles
  if (options.selectedSkill)
    startOptions.selectedSkill = options.selectedSkill

  return startOptions
}
