import type { AgentRuntime } from '@ant-chat/agent-core'
import type { AppDataServices } from '@ant-chat/app-data'
import type { AgentRuntimeStartTaskOptions, AgentRuntimeStartTaskResult, ApprovePendingActionOptions, CancelTaskOptions, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import process from 'node:process'

export interface AgentRuntimeService {
  startTurn: (options: StartAgentTurnOptions) => Promise<AgentRuntimeStartTaskResult>
  approvePendingAction: (options: ApprovePendingActionOptions) => null
  rejectPendingAction: (options: RejectPendingActionOptions) => null
  cancelTask: (options: CancelTaskOptions) => null
  injectSteering: (params: { conversationId: string, text: string }) => Promise<null>
  listActiveTasks: (conversationId?: string) => ReturnType<AgentRuntime['listActiveTasks']>
  approvePendingActionWithWhitelist: (options: ApprovePendingActionOptions & { remember: boolean, workspacePath?: string }) => null
}

export function createAgentRuntimeService(runtime: AgentRuntime, appDataServices: AppDataServices): AgentRuntimeService {
  return {
    async startTurn(options) {
      return await runtime.startTask(toRuntimeStartOptions(options, appDataServices))
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
          appDataServices.toolApprovalWhitelistRepository.add({
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
  appDataServices: AppDataServices,
): AgentRuntimeStartTaskOptions {
  const workspacePath = options.workspacePath
    ?? appDataServices.workspaceService.getCurrentWorkspacePath()
    ?? process.cwd()

  const startOptions: AgentRuntimeStartTaskOptions = {
    prompt: options.prompt,
    modelId: options.modelConfig.modelId,
    workspacePath,
    mode: options.mode ?? 'hybrid',
    chatSettings: {
      systemPrompt: options.modelConfig.systemPrompt,
      temperature: options.modelConfig.temperature,
      maxTokens: options.modelConfig.maxTokens,
    },
  }

  if (options.conversationId)
    startOptions.conversationId = options.conversationId
  if (options.images)
    startOptions.images = options.images
  if (options.attachments)
    startOptions.attachments = options.attachments
  if (options.referencedFiles)
    startOptions.referencedFiles = options.referencedFiles
  if (options.selectedSkill)
    startOptions.selectedSkill = options.selectedSkill

  return startOptions
}
