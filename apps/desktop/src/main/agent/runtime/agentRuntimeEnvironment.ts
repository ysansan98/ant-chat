import { createAgentRuntimeEnvironment } from '@ant-chat/agent-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { createElectronEventEmitter } from '@main/agent/adapters/electronEventEmitter.adapter'
import { logger } from '@main/utils/logger'

type DesktopAgentRuntimeEnvironment = ReturnType<typeof createAgentRuntimeEnvironment>

let environment: DesktopAgentRuntimeEnvironment | null = null

export function getAgentRuntimeEnvironment(): DesktopAgentRuntimeEnvironment {
  if (!environment) {
    environment = createAgentRuntimeEnvironment({
      appDataRoot: resolveAppDataRoot(),
      eventEmitter: createElectronEventEmitter(),
      logger,
    })
  }

  return environment
}
