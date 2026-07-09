import type { AgentMode, AgentRuntimeConfig, AgentTool, AgentToolResult, AgentTurnSource, RuntimeToolDefinition, SecretRef, SecretStore, SkillManifest, SkillReader, ToolOperationType, ToolScope } from '@ant-chat/shared'
import type { BrowserSessionState } from '../native-tools/tools/browserSessionManager'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
  truncateResult?: boolean
}

export interface CreateRegistryOptions {
  config: AgentRuntimeConfig
  workspacePath: string
  mode: AgentMode
  browserSession?: BrowserSessionState
  turnSource?: AgentTurnSource
}

export class ToolRegistry {
  private readonly tools: Map<string, AgentTool>
  private readonly relaxedTools: Map<string, AgentTool>

  static async create(options: CreateRegistryOptions): Promise<ToolRegistry> {
    const { config, workspacePath, mode, browserSession, turnSource } = options
    const unrestricted = mode === 'full_managed'
    const skillReader = resolveSkillReader(config)
    const readableRoots = await resolveTrustedRoots(skillReader, turnSource)
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
      ? await makeSkillTools(skillReader, turnSource)
      : []
    // 自动化能力在 Turn 创建时固定；记忆修改等交互能力不进入该能力集合。
    const agentLoopTools = config.memoryReader && turnSource?.type !== 'automation'
      ? [createMemoryTool(config.memoryReader)]
      : []
    if (config.secretRequester) {
      agentLoopTools.push(createRequestSecretTool())
    }
    const mcpTools = config.mcpClientHub
      ? createMcpTools(config.mcpClientHub)
      : []
    const allowedMcpServers = turnSource?.type === 'automation' ? turnSource.allowedMcpServers : undefined
    const allowedMcpTools = allowedMcpServers === undefined
      ? mcpTools
      : mcpTools.filter(tool => allowedMcpServers.includes(tool.serverName ?? ''))

    return new ToolRegistry(
      [...nativeTools, ...skillTools, ...agentLoopTools, ...allowedMcpTools],
      unrestricted ? undefined : relaxedNativeTools,
      config.secretStore,
    )
  }

  constructor(
    tools: AgentTool[],
    relaxedTools?: AgentTool[],
    private readonly secretStore?: SecretStore,
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
      execute: async () => resolvedTool.execute(await resolveToolInputSecrets(input, this.secretStore)),
      truncateResult: tool.truncateResult,
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

async function resolveTrustedRoots(skillReader: SkillReader | null, turnSource?: AgentTurnSource): Promise<string[]> {
  if (turnSource?.type !== 'automation') {
    return skillReader ? [skillReader.getSkillsRoot()] : []
  }

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
      '此工具不会返回真实值，只返回 SecretRef 或 secretRefs；后续工具应把 SecretRef 传给 bash.env 等字段。',
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

async function resolveToolInputSecrets(input: Record<string, unknown>, secretStore?: SecretStore): Promise<Record<string, unknown>> {
  if (!secretStore) {
    return input
  }
  const resolved: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (isSecretRef(value)) {
      const secret = await secretStore.resolve(value)
      if (!secret) {
        throw new Error(`Secret not found: ${value.id}`)
      }
      resolved[key] = secret
    }
    else if (isPlainRecord(value)) {
      resolved[key] = await resolveToolInputSecrets(value, secretStore)
    }
    else {
      resolved[key] = value
    }
  }
  return resolved
}

function isSecretRef(value: unknown): value is SecretRef {
  return isPlainRecord(value)
    && value.kind === 'secret_ref'
    && typeof value.id === 'string'
    && (value.scope === 'persistent' || value.scope === 'turn')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
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
      result: JSON.stringify(
        await memoryReader.editMemory({
          target: input.target as 'memory' | 'user',
          action: input.action as 'add' | 'replace' | 'remove',
          content: typeof input.content === 'string' ? input.content : undefined,
          old_text: typeof input.old_text === 'string' ? input.old_text : undefined,
        }),
      ),
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
    return [createResolvedUseSkillTool(capabilities)]
  }
  return [
    createUseSkillTool(skills, reader),
    createInstallSkillFromGithubTool(reader),
  ]
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
