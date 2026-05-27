import type { AgentTool, SkillManifest, SkillReader } from '@ant-chat/shared'
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_SKILL_INVALID } from '@ant-chat/shared'

// ---- Fixed Skill Tools ----

export function createUseSkillTool(skills: SkillManifest[], skillReader: SkillReader): AgentTool {
  const enabled = skills.filter(s => s.enabled)
  const skillsRoot = skillReader.getSkillsRoot()
  const lines = [
    'Load an installed skill. Returns <skill_content> with the SKILL.md instructions to follow, and <skill_files> with absolute paths to companion files (use read_file to access).',
  ]
  if (enabled.length > 0) {
    lines.push('', 'Available skills:')
    for (const skill of enabled) {
      lines.push(skill.description
        ? `- ${skill.name}: ${skill.description}`
        : `- ${skill.name}`)
    }
  }
  return {
    name: 'use_skill',
    source: 'skill',
    description: lines.join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the skill to load.' },
      },
      required: ['name'],
    },
    operationType: 'skill',
    inferScope: () => 'workspace',
    execute: async (input) => {
      const name = String(input.name || '')
      try {
        const content = await skillReader.readSkillMarkdown(name)
        const files = await listSkillFiles(skillsRoot, name)
        const output = [
          `<skill_content name="${name}">`,
          content,
          '</skill_content>',
          '',
          '<skill_files>',
          ...files.map(f => `- ${f}`),
          '</skill_files>',
        ].join('\n')
        return { ok: true, output }
      }
      catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : AGENT_SKILL_INVALID }
      }
    },
  }
}

export function createInstallSkillFromGithubTool(skillReader: SkillReader): AgentTool {
  const skillsRoot = skillReader.getSkillsRoot()
  return {
    name: 'install_skill_from_github',
    source: 'skill',
    description: `Install a skill from a GitHub repository into ${skillsRoot}.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'GitHub repository URL that contains SKILL.md.' },
        name: { type: 'string', description: 'Optional installed skill name override.' },
      },
      required: ['url'],
    },
    operationType: 'skill',
    inferScope: () => 'outside',
    execute: async (input) => {
      const url = String(input.url || '')
      const name = typeof input.name === 'string' ? input.name : undefined
      const manifest = await skillReader.importFromGithub({ url, name })
      return { ok: true, output: `Installed skill "${manifest.name}" to ${skillsRoot}/${manifest.name}` }
    },
  }
}

// ---- Internal Helpers ----

async function listSkillFiles(skillsRoot: string, name: string): Promise<string[]> {
  const skillPath = path.join(skillsRoot, name)
  const entries = await fs.promises.readdir(skillPath, { recursive: true, withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name !== 'manifest.json' && e.name !== '.index.json')
    .map(e => path.join(e.parentPath ?? skillPath, e.name))
    .sort()
}
