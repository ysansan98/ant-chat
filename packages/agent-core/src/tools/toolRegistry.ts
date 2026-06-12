import type { AgentMode, AgentRuntimeConfig, AgentTool, AgentToolResult, RuntimeToolDefinition, SkillManifest, SkillReader, ToolOperationType, ToolScope } from '@ant-chat/shared'
import type { BrowserSessionState } from '../native-tools/tools/browserSessionManager'
import fs from 'node:fs'
import path from 'node:path'
import { AGENT_SKILL_INVALID } from '@ant-chat/shared'
import { getNativeToolService } from '../native-tools/nativeToolService'
import { createMcpTools } from './mcpToolAdapter'

export interface PreparedToolCall {
  toolName: string
  source: AgentTool['source']
  serverName: string
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
  browserSession?: BrowserSessionState
}

export class ToolRegistry {
  private readonly tools: Map<string, AgentTool>
  private readonly relaxedTools: Map<string, AgentTool>

  static async create(options: CreateRegistryOptions): Promise<ToolRegistry> {
    const { config, workspacePath, mode, browserSession } = options
    const unrestricted = mode === 'full_managed'
    const skillReader = resolveSkillReader(config)
    const readableRoots = skillReader ? [skillReader.getSkillsRoot()] : []
    const nativeTools = getNativeToolService(workspacePath, unrestricted, {
      readableRoots,
      browser: config.browser,
      browserSession,
    }).getTools()
    const relaxedNativeTools = unrestricted
      ? nativeTools
      : getNativeToolService(workspacePath, true, {
          readableRoots,
          browser: config.browser,
          browserSession,
        }).getTools()
    const skillTools = skillReader
      ? await makeSkillTools(skillReader)
      : []
    const agentLoopTools = config.memoryReader
      ? [createMemoryTool(config.memoryReader)]
      : []
    const mcpTools = config.mcpClientHub
      ? createMcpTools(config.mcpClientHub)
      : []

    return new ToolRegistry(
      [...nativeTools, ...skillTools, ...agentLoopTools, ...mcpTools],
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
        serverName: 'native',
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
      serverName: tool.serverName || tool.source,
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
        serverName: tool.serverName || tool.source,
        description: tool.description!,
        inputSchema: tool.inputSchema!,
      }
    })
  }
}

function createMemoryTool(memoryReader: NonNullable<AgentRuntimeConfig['memoryReader']>): AgentTool {
  return {
    name: 'memory',
    source: 'skill',
    serverName: 'agent-loop',
    description: [
      'Edit persistent agent memory files using add, replace, or remove.',
      'Use target="memory" for the agent personal notes: durable environment facts, project conventions, and tool behavior.',
      'Use target="user" for the user memory: durable preferences, communication style, and habits.',
      'Save compact facts that will still matter later and reduce future user steering.',
      'Write memories as declarative facts, not instructions. Example: "User prefers concise responses", not "Always respond concisely".',
      'Do not use this tool for temporary task progress, session outcomes, completed-work logs, chat summaries, stale identifiers, file contents, secrets, or SOUL.md. SOUL.md defines the agent identity and is edited only by the user.',
      'Updates are written to disk. The system prompt uses the conversation-start USER.md/MEMORY.md snapshot, and this tool returns the latest entries after each successful edit.',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['memory', 'user'], description: 'File to edit: memory edits MEMORY.md, user edits USER.md.' },
        action: { type: 'string', enum: ['add', 'replace', 'remove'], description: 'Edit action.' },
        content: { type: 'string', description: 'Required for add and replace. For replace, this becomes the full replacement entry.' },
        old_text: { type: 'string', description: 'Required for replace and remove. Used only to locate the entry by substring match.' },
      },
      required: ['target', 'action'],
    },
    operationType: 'skill',
    inferScope: () => 'workspace',
    validateInput: (input) => {
      if (input.target !== 'memory' && input.target !== 'user') {
        return 'target must be "memory" or "user"'
      }
      if (input.action !== 'add' && input.action !== 'replace' && input.action !== 'remove') {
        return 'action must be "add", "replace", or "remove"'
      }
      if (input.action === 'add' && typeof input.content !== 'string') {
        return 'content is required for add'
      }
      if (input.action === 'replace' && (typeof input.old_text !== 'string' || typeof input.content !== 'string')) {
        return 'old_text and content are required for replace'
      }
      if (input.action === 'remove' && typeof input.old_text !== 'string') {
        return 'old_text is required for remove'
      }
      return null
    },
    execute: async input => ({
      ok: true,
      output: await memoryReader.editMemory({
        target: input.target as 'memory' | 'user',
        action: input.action as 'add' | 'replace' | 'remove',
        content: typeof input.content === 'string' ? input.content : undefined,
        old_text: typeof input.old_text === 'string' ? input.old_text : undefined,
      }),
    }),
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
  return null
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
