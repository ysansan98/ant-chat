import { getAgentRuntimeEnvironment } from '@main/agent/runtime/agentRuntimeEnvironment'

export function getSkillsRoot(): string {
  return getAgentRuntimeEnvironment().paths.skillsRoot
}
