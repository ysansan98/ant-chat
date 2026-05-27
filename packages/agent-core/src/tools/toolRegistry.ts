import type { AgentMode, AgentRuntimeConfig, AgentTool, AgentToolResult, RuntimeToolDefinition, SkillManifest, SkillReader, ToolOperationType, ToolScope } from '@ant-chat/shared'
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_SKILL_INVALID } from '@ant-chat/shared'
import { getNativeToolService } from '../native-tools/nativeToolService'
import { SkillFsReader } from '../skills/skillFsReader'

export interface PreparedToolCall {
  toolName: string
  source: AgentTool['source']
  input: Record<string, unknown>
  operationType: ToolOperationType
  scope: ToolScope
  validationError?: string
  execute: () => Promise<AgentToolResult>
  formatObservation?: AgentTool['formatObservation']
  formatError?: AgentTool['formatError']
  truncateObservation?: boolean
}

export interface CreateRegistryOptions {
  config: AgentRuntimeConfig
  workspacePath: string
  mode: AgentMode
}

export class ToolRegistry {
  private readonly tools: Map<string, AgentTool>
  private readonly relaxedTools: Map<string, AgentTool>

  static async create(options: CreateRegistryOptions): Promise<ToolRegistry> {
    const { config, workspacePath, mode } = options
    const unrestricted = mode === 'full_managed'
    const skillReader = resolveSkillReader(config)
    const readableRoots = skillReader ? [skillReader.getSkillsRoot()] : []
    const nativeTools = getNativeToolService(workspacePath, unrestricted, { readableRoots }).getTools()
    const relaxedNativeTools = unrestricted
      ? nativeTools
      : getNativeToolService(workspacePath, true, { readableRoots }).getTools()
    const skillTools = skillReader
      ? await makeSkillTools(skillReader)
      : []

    return new ToolRegistry(
      [...nativeTools, ...skillTools],
      unrestricted ? undefined : relaxedNativeTools,
    )
  }

  constructor(tools: AgentTool[], relaxedTools?: AgentTool[]) {
    for (const tool of tools) {
      if (!tool.description || !tool.inputSchema) {
        throw new Error(`Tool "${tool.name}" is missing required description or inputSchema`)
      }
    }
    this.tools = new Map(tools.map(tool => [tool.name, tool]))
    this.relaxedTools = relaxedTools
      ? new Map(relaxedTools.map(tool => [tool.name, tool]))
      : new Map()
  }

  prepare(toolName: string, input: Record<string, unknown>): PreparedToolCall {
    const tool = this.tools.get(toolName)
    if (!tool) {
      return {
        toolName,
        source: 'native',
        input,
        operationType: 'read',
        scope: 'blocked',
        execute: async () => ({ ok: false, error: 'AGENT_TOOL_EXEC_FAILED' }),
      }
    }

    const validationError = tool.validateInput?.(input) ?? undefined
    const scope = safeInferScope(tool, input)
    const operationType = tool.operationType

    const resolvedTool = scope === 'outside' ? (this.relaxedTools.get(toolName) ?? tool) : tool

    return {
      toolName,
      source: tool.source,
      input,
      operationType,
      scope,
      validationError,
      execute: () => resolvedTool.execute(input),
      formatObservation: tool.formatObservation,
      formatError: tool.formatError,
      truncateObservation: tool.truncateObservation,
    }
  }

  listTools(): RuntimeToolDefinition[] {
    return [...this.tools.values()].map((tool) => {
      return {
        name: tool.name,
        source: tool.source,
        description: tool.description!,
        inputSchema: tool.inputSchema!,
      }
    })
  }
}

function safeInferScope(tool: AgentTool, input: Record<string, unknown>): ToolScope {
  try {
    return tool.inferScope(input)
  }
  catch {
    return 'blocked'
  }
}

function resolveSkillReader(config: AgentRuntimeConfig): SkillReader | null {
  if (config.skillReader) {
    return config.skillReader
  }
  if (!config.skillsRoot) {
    return null
  }
  return new SkillFsReader({ skillsRoot: config.skillsRoot })
}

async function makeSkillTools(reader: SkillReader): Promise<AgentTool[]> {
  const skills = await reader.getEnabledSkills()
  return [
    createUseSkillTool(skills, reader),
    createInstallSkillFromGithubTool(reader),
  ]
}

// ---- Skill tool factories ----

function createUseSkillTool(skills: SkillManifest[], skillReader: SkillReader): AgentTool {
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

function createInstallSkillFromGithubTool(skillReader: SkillReader): AgentTool {
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

async function listSkillFiles(skillsRoot: string, name: string): Promise<string[]> {
  const skillPath = path.join(skillsRoot, name)
  const entries = await fs.promises.readdir(skillPath, { recursive: true, withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name !== 'manifest.json' && e.name !== '.index.json')
    .map(e => path.join(e.parentPath ?? skillPath, e.name))
    .sort()
}
