import type { AgentMode, AgentRuntimeConfig, AgentTool, AgentToolResult, AgentTurnSource, RuntimeToolDefinition, SkillManifest, SkillReader, ToolOperationType, ToolScope } from '@ant-chat/shared'
import type { BrowserSessionState } from '../native-tools/tools/browserSessionManager'
import type { PreparedNativeTool } from '../native-tools/tools/toolFactory'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getNativeToolService } from '../native-tools/nativeToolService'
import { createMcpTools } from './mcpToolAdapter'
import { createMemoryCatalogTools } from './memoryCatalogTools'
import { createMessageSearchTools } from './messageSearchTools'
import { createPublishVisualizationTool } from './publishVisualizationTool'

export interface PreparedToolCall {
  toolName: string
  source: AgentTool['source']
  serverName: string
  /** MCP 工具的原始 toolName（不与 serverName 拼接）；非 MCP 工具为 undefined */
  originalToolName?: string
  input: Record<string, unknown>
  operationType: ToolOperationType
  scope: ToolScope
  validationError?: string
  /** 工具在 prepare 阶段固定的私有状态；只有 owning tool 与授权层解释。 */
  preparedState?: unknown
  execute: () => Promise<AgentToolResult>
  truncateResult?: boolean
}

export interface CreateRegistryOptions {
  config: AgentRuntimeConfig
  workspacePath: string
  mode: AgentMode
  browserSession?: BrowserSessionState
  turnSource?: AgentTurnSource
  runId?: string
}

type AutomationTurnSource = Extract<AgentTurnSource, { type: 'automation' }>

export class ToolRegistry {
  private readonly tools: Map<string, AgentTool>
  private readonly relaxedTools: Map<string, AgentTool>
  static async create(options: CreateRegistryOptions): Promise<ToolRegistry> {
    const { config, workspacePath, mode, browserSession, turnSource, runId } = options
    const unrestricted = mode === 'full_managed'
    const skillReader = resolveSkillReader(config)
    const trustedPaths = turnSource?.type === 'automation'
      ? await resolveAutomationTrustedPaths(skillReader, turnSource)
      : []
    const nativeTools = filterNativeToolsForTurn(getNativeToolService(workspacePath, unrestricted, {
      trustedPaths,
      browser: config.browser,
      browserAuthState: config.browserAuthState,
      commandHost: config.commandHost,
      browserSession,
      secretStore: config.secretStore,
      runId,
    }).getTools(), turnSource)
    const relaxedNativeTools = unrestricted
      ? nativeTools
      : filterNativeToolsForTurn(getNativeToolService(workspacePath, true, {
          trustedPaths,
          browser: config.browser,
          browserAuthState: config.browserAuthState,
          commandHost: config.commandHost,
          browserSession,
          secretStore: config.secretStore,
          runId,
        }).getTools(), turnSource)
    const skillTools = skillReader
      ? await makeSkillTools(skillReader, turnSource)
      : []
    // 自动化能力在 Turn 创建时固定；propose_memory 等交互能力在工具内按 turn 来源拒绝。
    const agentLoopTools: AgentTool[] = []
    if (config.messageSearch) {
      agentLoopTools.push(...createMessageSearchTools(config.messageSearch, workspacePath))
    }
    if (config.memoryCatalog) {
      agentLoopTools.push(...createMemoryCatalogTools(config.memoryCatalog, { workspacePath, turnSource }))
    }
    if (config.secretRequester) {
      agentLoopTools.push(createRequestSecretTool())
    }
    const mcpTools = config.mcpClientHub
      ? createMcpTools(config.mcpClientHub)
      : []
    const allowedMcpServers = turnSource?.type === 'automation'
      ? (turnSource.permissionPolicy.allowMcpTools ? turnSource.allowedMcpServers : [])
      : undefined
    const allowedMcpTools = allowedMcpServers === undefined
      ? mcpTools
      : mcpTools.filter(tool => allowedMcpServers.includes(tool.serverName ?? ''))

    return new ToolRegistry(
      [...nativeTools, ...skillTools, ...agentLoopTools, ...allowedMcpTools],
      unrestricted ? undefined : relaxedNativeTools,
    )
  }

  constructor(
    tools: AgentTool[],
    relaxedTools?: AgentTool[],
  ) {
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
        execute: async () => ({ ok: false, result: `未找到工具：${toolName}` }),
      }
    }

    const validationError = tool.validateInput?.(input) ?? undefined
    // 输入必须先通过公开校验，再创建工具私有 prepare 状态。
    const toolPreparation = validationError
      ? undefined
      : (tool as PreparedNativeTool).prepare?.(input)
    const scope = toolPreparation?.scope ?? safeInferScope(tool, input)
    const operationType = toolPreparation?.operationType ?? tool.operationType

    const resolvedTool = scope === 'outside' ? (this.relaxedTools.get(toolName) ?? tool) : tool
    const executePrepared = toolPreparation
      ? scope === 'outside' && this.relaxedTools.has(toolName)
        ? (toolPreparation.executeRelaxed ?? resolvedTool.execute.bind(resolvedTool))
        : toolPreparation.execute
      : undefined

    const prepared: PreparedToolCall = {
      toolName,
      source: tool.source,
      serverName: tool.serverName || tool.source,
      originalToolName: tool.originalToolName,
      input,
      operationType,
      scope,
      validationError,
      preparedState: toolPreparation?.state,
      execute: async () => executePrepared
        ? executePrepared(input)
        : resolvedTool.execute(input),
      truncateResult: tool.truncateResult,
    }
    return prepared
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

function filterNativeToolsForTurn(tools: AgentTool[], turnSource?: AgentTurnSource): AgentTool[] {
  if (turnSource?.type !== 'automation' || turnSource.permissionPolicy.allowBrowser)
    return tools
  return tools.filter(tool => !tool.name.startsWith('browser_'))
}

async function resolveAutomationTrustedPaths(skillReader: SkillReader | null, turnSource: AutomationTurnSource): Promise<string[]> {
  const roots = turnSource.permissionPolicy.extraFileRoots
    .map(root => root.trim())
    .filter(Boolean)
    .map(resolveConfiguredRoot)
  if (!skillReader || !turnSource.permissionPolicy.allowSelectedSkillRuntime) {
    return roots
  }

  const allowed = new Set(turnSource.allowedSkills.map(name => name.trim()).filter(Boolean))
  if (allowed.size === 0) {
    return roots
  }
  const skills = await skillReader.getEnabledSkills()
  for (const skill of skills) {
    if (allowed.has(skill.name)) {
      roots.push(path.join(skillReader.getSkillsRoot(), skill.name))
    }
  }
  return roots
}

function resolveConfiguredRoot(rootPath: string): string {
  const trimmed = rootPath.trim()
  if (trimmed === '~') {
    return os.homedir()
  }
  if (trimmed.startsWith('~/')) {
    return path.join(os.homedir(), trimmed.slice(2))
  }
  return path.resolve(trimmed)
}

function createRequestSecretTool(): AgentTool {
  return {
    name: 'requestSecret',
    source: 'skill',
    serverName: 'agent-loop',
    description: [
      '向用户请求当前任务临时使用的敏感信息。',
      '当工具需要密码、token、验证码、账号密码等一个或多个敏感字段时使用。',
      '单字段可传 label；多字段传 fields，例如 [{ key: "username", label: "账号" }, { key: "password", label: "密码" }]。',
      '此工具不会返回真实值，只返回 SecretRef 或 secretRefs；后续只能把当前 Turn 的 SecretRef 传给 execute_command.secretEnv。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string', description: '展示给用户的短标签，例如“部署密码”。多字段请求时作为整体标题。' },
        fields: {
          type: 'array',
          description: '可选。一次请求多个敏感字段，每项包含 key 和 label。',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: '返回 secretRefs 中使用的字段名，例如 username。' },
              label: { type: 'string', description: '展示给用户的字段标签，例如“账号”。' },
            },
            required: ['key', 'label'],
          },
        },
        reason: { type: 'string', description: '展示给用户的可选原因。' },
      },
      required: [],
    },
    operationType: 'skill',
    inferScope: () => 'workspace',
    validateInput: (input) => {
      if (input.label !== undefined && (typeof input.label !== 'string' || !input.label.trim())) {
        return 'label must be a non-empty string'
      }
      if (input.fields !== undefined) {
        if (!Array.isArray(input.fields) || input.fields.length === 0) {
          return 'fields must be a non-empty array'
        }
        for (const field of input.fields) {
          if (!isPlainRecord(field) || typeof field.key !== 'string' || !field.key.trim() || typeof field.label !== 'string' || !field.label.trim()) {
            return 'fields must contain key and label'
          }
        }
      }
      if (input.fields === undefined && (typeof input.label !== 'string' || !input.label.trim())) {
        return 'label is required when fields is not provided'
      }
      if (input.reason !== undefined && typeof input.reason !== 'string') {
        return 'reason must be a string'
      }
      return null
    },
    execute: async () => ({ ok: false, result: 'requestSecret must be executed by runtime' }),
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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

interface ResolvedSkillCapability {
  manifest: SkillManifest
  content: string
  files: string[]
}

async function makeSkillTools(reader: SkillReader, turnSource?: AgentTurnSource): Promise<AgentTool[]> {
  const skills = await reader.getEnabledSkills()
  if (turnSource?.type === 'automation') {
    const allowed = new Set(turnSource.allowedSkills.map(name => name.trim()).filter(Boolean))
    if (allowed.size === 0)
      return []
    const matchedSkills = skills.filter(skill => allowed.has(skill.name))
    if (matchedSkills.length === 0)
      return []
    const capabilities = await Promise.all(matchedSkills.map(async manifest => ({
      manifest,
      content: await reader.readSkillMarkdown(manifest.name),
      files: await listSkillFiles(reader.getSkillsRoot(), manifest.name),
    })))
    const tools: AgentTool[] = [createResolvedUseSkillTool(capabilities)]
    if (matchedSkills.some(skill => skill.name === 'visualize' && skill.enabled)) {
      tools.push(createPublishVisualizationTool())
    }
    return tools
  }
  const tools: AgentTool[] = [
    createUseSkillTool(skills, reader),
    createInstallSkillFromGithubTool(reader),
  ]
  if (skills.some(skill => skill.name === 'visualize' && skill.enabled)) {
    tools.push(createPublishVisualizationTool())
  }
  return tools
}

function createResolvedUseSkillTool(capabilities: ResolvedSkillCapability[]): AgentTool {
  const capabilityByName = new Map(capabilities.map(capability => [capability.manifest.name, capability]))
  const tool = createUseSkillToolDefinition(capabilities.map(capability => capability.manifest))
  return {
    ...tool,
    execute: async (input) => {
      const capability = capabilityByName.get(String(input.name || '').trim())
      if (!capability)
        return { ok: false, result: '技能加载失败：当前执行未注入该 Skill' }
      return { ok: true, result: formatSkillContent(capability.manifest.name, capability.content, capability.files) }
    },
  }
}

// ---- Skill tool factories ----

function createUseSkillTool(skills: SkillManifest[], skillReader: SkillReader): AgentTool {
  const enabled = skills.filter(s => s.enabled)
  const skillsRoot = skillReader.getSkillsRoot()
  const tool = createUseSkillToolDefinition(enabled)
  return {
    ...tool,
    execute: async (input) => {
      const name = String(input.name || '').trim()
      try {
        const content = await skillReader.readSkillMarkdown(name)
        const files = await listSkillFiles(skillsRoot, name)
        return { ok: true, result: formatSkillContent(name, content, files) }
      }
      catch (error) {
        return { ok: false, result: formatSkillError(error) }
      }
    },
  }
}

function createUseSkillToolDefinition(enabled: SkillManifest[]): Omit<AgentTool, 'execute'> {
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
        name: { type: 'string', enum: enabled.map(skill => skill.name), description: 'Name of the skill to load.' },
      },
      required: ['name'],
    },
    operationType: 'skill',
    inferScope: () => 'workspace',
    validateInput: input => String(input.name || '').trim() ? null : 'name must be a non-empty string',
  }
}

function formatSkillContent(name: string, content: string, files: string[]): string {
  return [
    `<skill_content name="${name}">`,
    content,
    '</skill_content>',
    '',
    '<skill_files>',
    ...files.map(f => `- ${f}`),
    '</skill_files>',
  ].join('\n')
}

function formatSkillError(error: unknown): string {
  if (!(error instanceof Error)) {
    return '技能加载失败。'
  }
  const message = error.message.replace(/^AGENT_SKILL_INVALID:?\s*/u, '').trim()
  return message ? `技能加载失败：${message}` : '技能加载失败。'
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
      return { ok: true, result: `Installed skill "${manifest.name}" to ${skillsRoot}/${manifest.name}` }
    },
  }
}

async function listSkillFiles(skillsRoot: string, name: string): Promise<string[]> {
  const skillPath = path.join(skillsRoot, name)
  const entries = await fs.promises.readdir(skillPath, { recursive: true, withFileTypes: true })
  return entries
    .filter(e => e.isFile() && e.name !== '.index.json')
    .map(e => path.join(e.parentPath ?? skillPath, e.name))
    .sort()
}
