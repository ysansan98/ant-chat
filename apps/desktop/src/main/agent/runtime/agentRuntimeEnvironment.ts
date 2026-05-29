import { createAgentRuntimeEnvironment } from '@ant-chat/agent-runtime'
import { createElectronEventEmitter } from '@main/agent/adapters/electronEventEmitter.adapter'
import { getAppDataRoot } from '@main/utils/appPaths'
import { logger } from '@main/utils/logger'

type DesktopAgentRuntimeEnvironment = ReturnType<typeof createAgentRuntimeEnvironment>

let environment: DesktopAgentRuntimeEnvironment | null = null

export function getAgentRuntimeEnvironment(): DesktopAgentRuntimeEnvironment {
  if (!environment) {
    environment = createAgentRuntimeEnvironment({
      appDataRoot: getAppDataRoot(),
      eventEmitter: createElectronEventEmitter(),
      logger,
    })
  }

  return environment
}
