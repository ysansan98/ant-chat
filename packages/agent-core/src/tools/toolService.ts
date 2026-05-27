import type { AgentMode, AgentRuntimeConfig, AgentTool } from '@ant-chat/shared'
import { getNativeToolService } from '../native-tools/nativeToolService'
import { SkillFsService } from '../skills/skillFsService'
import { createInstallSkillFromGithubTool, createUseSkillTool } from '../skills/skillToolService'

export interface CreateRuntimeToolsOptions {
  config: AgentRuntimeConfig
  workspacePath: string
  mode: AgentMode
}

export async function createRuntimeTools(options: CreateRuntimeToolsOptions): Promise<{
  tools: AgentTool[]
  relaxedTools?: AgentTool[]
}> {
  const { config, workspacePath, mode } = options
  const unrestricted = mode === 'full_managed'
  const readableRoots = getReadableRoots(config)
  const nativeTools = getNativeToolService(workspacePath, unrestricted, { readableRoots }).getTools()
  const relaxedNativeTools = unrestricted
    ? nativeTools
    : getNativeToolService(workspacePath, true, { readableRoots }).getTools()
  const skillTools = await createSkillTools(config)

  return {
    tools: [...nativeTools, ...skillTools],
    relaxedTools: unrestricted ? undefined : relaxedNativeTools,
  }
}

function getReadableRoots(config: AgentRuntimeConfig): string[] {
  const skillsRoot = getSkillReader(config)?.getSkillsRoot()
  return skillsRoot ? [skillsRoot] : []
}

async function createSkillTools(config: AgentRuntimeConfig): Promise<AgentTool[]> {
  const skillReader = getSkillReader(config)
  if (!skillReader) {
    return []
  }

  const skills = await skillReader.getEnabledSkills()
  return [
    createUseSkillTool(skills, skillReader),
    createInstallSkillFromGithubTool(skillReader),
  ]
}

function getSkillReader(config: AgentRuntimeConfig) {
  if (config.skillReader) {
    return config.skillReader
  }
  if (!config.skillsRoot) {
    return null
  }
  return new SkillFsService({ skillsRoot: config.skillsRoot })
}
