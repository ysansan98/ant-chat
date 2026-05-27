import type { AgentRuntimeHost } from '@ant-chat/shared'
import { getAppDataServices } from '@main/adapters/appDataContainer'
import { createElectronEventEmitter } from '@main/agent/adapters/electronEventEmitter.adapter'
import { createElectronSessionStore } from '@main/agent/adapters/electronSessionStore.adapter'
import { getSkillsRoot } from '@main/domains/skills/skillsRoot'
import { LogPathManager } from '@main/utils/logPathManager'
import { TaskLogWriter } from '@main/utils/taskLogWriter'

export function createDesktopAgentHost(): AgentRuntimeHost {
  const logPathManager = LogPathManager.getInstance()
  const appDataServices = getAppDataServices()

  return {
    sessionStore: createElectronSessionStore(),
    modelCatalog: appDataServices.modelCatalog,
    skillsRoot: getSkillsRoot(),
    eventEmitter: createElectronEventEmitter(),
    createTaskLogger: (conversationId: string, userMessageId: string) => {
      const filePath = logPathManager.getTaskLogPath(conversationId, userMessageId)
      return new TaskLogWriter(filePath)
    },
    getToolApprovalWhitelistEntries: () => {
      return appDataServices.toolApprovalWhitelistRepository.getAll()
    },
  }
}
