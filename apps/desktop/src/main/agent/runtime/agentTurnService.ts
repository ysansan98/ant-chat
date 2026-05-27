import type { AgentRuntime } from '@ant-chat/agent-core'
import type { AgentRuntimeStartTaskOptions, AgentTurnResult, StartAgentTurnOptions } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { createDesktopAgentRuntime } from './desktopAgentRuntime'

let _agentRuntime: AgentRuntime | null = null

function getAgentRuntime(): AgentRuntime {
  if (!_agentRuntime) {
    _agentRuntime = createDesktopAgentRuntime()
  }
  return _agentRuntime
}

export const agentRuntime = new Proxy({} as AgentRuntime, {
  get(_, prop) {
    return (getAgentRuntime() as any)[prop]
  },
})

export async function startAgentTurn(options: StartAgentTurnOptions): Promise<AgentTurnResult> {
  const workspacePath = options.workspacePath
    ?? getAppDataServices().workspaceService.getCurrentWorkspacePath()
    ?? process.cwd()

  const startOptions: AgentRuntimeStartTaskOptions = {
    prompt: options.prompt,
    modelId: options.chatSettings.modelId,
    workspacePath,
    mode: options.mode ?? 'hybrid',
    chatSettings: {
      systemPrompt: options.chatSettings.systemPrompt,
      temperature: options.chatSettings.temperature,
      maxTokens: options.chatSettings.maxTokens,
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

  return await agentRuntime.startTask(startOptions)
}
