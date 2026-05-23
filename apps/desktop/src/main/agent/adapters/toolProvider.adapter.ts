import type { ToolProvider } from '@ant-chat/shared'
import { getNativeToolService } from '@main/agent/native-tools/nativeToolService'
import { getSkillToolService } from '@main/agent/skills/skillToolService'

export const electronToolProvider: ToolProvider = async (workspacePath, mode) => {
  const unrestricted = mode === 'full_managed'
  const nativeTools = getNativeToolService(workspacePath, unrestricted).getTools()
  const skillTools = (await getSkillToolService()).getTools()
  return [...nativeTools, ...skillTools]
}
