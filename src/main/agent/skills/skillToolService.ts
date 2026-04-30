import type { AgentTool, AgentToolResult, SkillManifest } from '@ant-chat/shared'
import { AGENT_SKILL_INVALID } from '@ant-chat/shared'
import { skillFsService } from '@main/skills/skillFsService'

const MAX_SKILL_CONTENT_CHARS = 20_000

export interface SkillLoadedOutput {
  type: 'skill_loaded'
  name: string
  content: string
}

export class SkillToolService {
  constructor(private readonly skills: SkillManifest[]) {}

  getTools(): AgentTool[] {
    const tools = [
      this.createUseSkillTool(),
      this.createInstallSkillFromGithubTool(),
      ...this.skills
        .filter(skill => skill.enabled)
        .map(skill => this.createSkillAliasTool(skill)),
    ]
    return tools
  }

  private createUseSkillTool(): AgentTool {
    return {
      name: 'use_skill',
      source: 'skill',
      description: 'Load an installed skill into the current agent context before following its instructions.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Installed skill name.' },
          task: { type: 'string', description: 'Current task that needs the skill.' },
        },
        required: ['name'],
      },
      inferRisk: () => 'L0',
      execute: async (input) => {
        const name = String(input.name || '')
        return this.loadSkill(name)
      },
    }
  }

  private createInstallSkillFromGithubTool(): AgentTool {
    return {
      name: 'install_skill_from_github',
      source: 'skill',
      description: 'Install a skill from a GitHub repository or GitHub tree URL into ~/.ant-chat/skills.',
      inputSchema: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'GitHub repository URL or tree URL that contains SKILL.md.' },
          name: { type: 'string', description: 'Optional installed skill name override.' },
        },
        required: ['url'],
      },
      inferRisk: () => 'L2',
      execute: async (input) => {
        const url = String(input.url || '')
        const name = typeof input.name === 'string' ? input.name : undefined
        const manifest = await skillFsService.importFromGithub({ url, name })
        return {
          ok: true,
          output: {
            installed: manifest.name,
            path: `${skillFsService.getSkillsRoot()}/${manifest.name}`,
          },
        }
      },
    }
  }

  private createSkillAliasTool(skill: SkillManifest): AgentTool {
    const toolName = `skill_${skill.name.replace(/\W/g, '_')}`
    return {
      name: toolName,
      source: 'skill',
      description: skill.description
        ? `Load skill "${skill.name}": ${skill.description}`
        : `Load skill "${skill.name}" into the current agent context.`,
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Current task that needs the skill.' },
        },
        required: [],
      },
      inferRisk: () => 'L0',
      execute: async () => this.loadSkill(skill.name),
    }
  }

  private async loadSkill(name: string): Promise<AgentToolResult> {
    try {
      const content = await skillFsService.readSkillMarkdown(name)
      const output: SkillLoadedOutput = {
        type: 'skill_loaded',
        name,
        content: truncateSkillContent(content),
      }
      return { ok: true, output }
    }
    catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : AGENT_SKILL_INVALID,
      }
    }
  }
}

export async function getSkillToolService(): Promise<SkillToolService> {
  return new SkillToolService(await skillFsService.getEnabledSkills())
}

function truncateSkillContent(content: string): string {
  if (content.length <= MAX_SKILL_CONTENT_CHARS) {
    return content
  }
  return `${content.slice(0, MAX_SKILL_CONTENT_CHARS)}\n\n[skill content truncated]`
}
