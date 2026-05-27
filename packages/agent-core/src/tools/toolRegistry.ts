import type { AgentMode, AgentRuntimeConfig, AgentTool, AgentToolResult, RuntimeToolDefinition, ToolOperationType, ToolScope } from '@ant-chat/shared'
import { getNativeToolService } from '../native-tools/nativeToolService'
import { SkillFsService } from '../skills/skillFsService'
import { createInstallSkillFromGithubTool, createUseSkillTool } from '../skills/skillToolService'

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
    const readableRoots = getReadableRoots(config)
    const nativeTools = getNativeToolService(workspacePath, unrestricted, { readableRoots }).getTools()
    const relaxedNativeTools = unrestricted
      ? nativeTools
      : getNativeToolService(workspacePath, true, { readableRoots }).getTools()
    const skillTools = await createSkillTools(config)

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
