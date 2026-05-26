import type { ToolProvider } from '@ant-chat/shared'
import { getNativeToolService } from '@main/agent/native-tools/nativeToolService'
import { createInstallSkillFromGithubTool, createUseSkillTool } from '@main/agent/skills/skillToolService'
import { skillFsService } from '@main/skills/skillFsService'

export const electronToolProvider: ToolProvider = async (workspacePath, mode) => {
  const unrestricted = mode === 'full_managed'
  const nativeTools = getNativeToolService(workspacePath, unrestricted).getTools()
  const skills = await skillFsService.getEnabledSkills()
  return [...nativeTools, createUseSkillTool(skills), createInstallSkillFromGithubTool()]
}
