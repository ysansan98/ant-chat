import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'

export function getAppDataServices() {
  return getAgentRuntimeEnvironment().appDataServices
}
