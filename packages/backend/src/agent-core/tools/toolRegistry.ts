import type { AgentMode, AgentRuntimeConfig, AgentTool, AgentToolResult, AgentTurnSource, ILogger, RuntimeToolDefinition, SkillManifest, SkillReader, ToolOperationType, ToolScope } from '@ant-chat/shared'
import type { BrowserSessionState } from '../native-tools/tools/browserSessionManager'
import type { PreparedNativeTool } from '../native-tools/tools/toolFactory'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { WORKSPACE_SKILLS_DIR } from '@ant-chat/shared'
import { getAgentLogger } from '../logger'
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
  execute: (abortSignal?: AbortSignal) => Promise<AgentToolResult>
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
    const logger = getAgentLogger(config)
    const unrestricted = mode === 'full_managed'
    const skillReader = resolveSkillReader(config)
    const skillEntries = skillReader
      ? await catchToolSourceError('skill', () => resolveSkillEntriesForTurn(skillReader, workspacePath, turnSource), logger)
      : []
    const trustedPaths = turnSource?.type === 'automation'
      ? await resolveAutomationTrustedPaths(skillReader, turnSource, workspacePath, skillEntries)
      : []
    const nativeTools = filterNativeToolsForTurn(getNativeToolService(workspacePath, unrestricted, {
      trustedPaths,
      browser: config.browser,
      browserAuthState: config.browserAuthState,
      commandHost: config.commandHost,
      browserSession,
      secretStore: config.secretStore,
      runId,
      turnSource,
      channelAttachmentSender: config.channelAttachmentSender,
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
          turnSource,
          channelAttachmentSender: config.channelAttachmentSender,
        }).getTools(), turnSource)
    const skillTools = skillReader
      ? await catchToolSourceError('skill', () => makeSkillTools(skillReader, workspacePath, skillEntries, turnSource), logger)
      : []
    // 自动化能力在 Turn 创建时固定；记忆修改等交互能力不进入自动化能力集合。
    const agentLoopTools: AgentTool[] = []
    if (config.memoryReader && turnSource?.type !== 'automation') {
      agentLoopTools.push(createMemoryTool(config.memoryReader))
    }
    if (config.messageSearch) {
      agentLoopTools.push(...catchToolSourceErrorSync('message-search', () => createMessageSearchTools(config.messageSearch!, workspacePath), logger))
    }
    if (config.memoryCatalog) {
      agentLoopTools.push(...catchToolSourceErrorSync('memory-catalog', () => createMemoryCatalogTools(config.memoryCatalog!, { workspacePath, turnSource }), logger))
    }
    if (config.secretRequester) {
      agentLoopTools.push(createRequestSecretTool())
    }
    const mcpTools = config.mcpClientHub
      ? catchToolSourceErrorSync('mcp', () => createMcpTools(config.mcpClientHub!), logger)
      : []
    // native 工具失败维持熔断，不做捕错剔除。
    // 构造器 description/inputSchema 校验保留。
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
    const executePrepared: ((input: Record<string, unknown>, abortSignal?: AbortSignal) => Promise<AgentToolResult>) | undefined = toolPreparation
      ? scope === 'outside' && this.relaxedTools.has(toolName)
        ? (toolPreparation.executeRelaxed ?? (input => resolvedTool.execute(input)))
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
      execute: async (abortSignal?: AbortSignal) => executePrepared
        ? executePrepared(input, abortSignal)
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

async function resolveAutomationTrustedPaths(
  skillReader: SkillReader | null,
  turnSource: AutomationTurnSource,
  workspacePath: string,
  skillEntries: ResolvedSkillEntry[],
): Promise<string[]> {
  const roots = turnSource.permissionPolicy.extraFileRoots
    .map(root => root.trim())
    .filter(Boolean)
    .map(resolveConfiguredRoot)
  if (!skillReader || !turnSource.permissionPolicy.allowSelectedSkillRuntime) {
    return roots
  }

  // skillEntries 已按 allowedSkills 过滤；按其来源把技能目录加入受信路径。
  for (const entry of skillEntries) {
    roots.push(entry.origin === 'workspace'
      ? path.join(workspacePath, WORKSPACE_SKILLS_DIR, entry.manifest.name)
      : path.join(skillReader.getSkillsRoot(), entry.manifest.name))
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

/**
 * 全局 prompt 快照记忆（USER.md / MEMORY.md）的编辑工具。
 *
 * 与 MemoryCatalog（propose_memory → 用户批准）是两层：本工具写的是
 * 每轮注入的全局快照（短、稳定、无证据链），不是人工批准的结论层。
 * agent 主动维护的是 MEMORY.md（agent personal notes）；USER.md 用于用户偏好。
 * 自动化 turn 不获得本工具。
 */
function createMemoryTool(memoryReader: NonNullable<AgentRuntimeConfig['memoryReader']>): AgentTool {
  return {
    name: 'memory',
    source: 'skill',
    serverName: 'agent-loop',
    description: [
      '编辑全局记忆快照（USER.md / MEMORY.md），支持 add / replace / remove。',
      'target="memory" 用于 agent 个人笔记：持久的环境事实、项目约定、工具行为（本套记忆就是让 agent 主动记忆的）。',
      'target="user" 用于用户记忆：持久偏好、沟通风格、习惯。',
      '写声明式事实而非指令，例如「用户偏好简洁回答」，而不是「总是简洁回答」。',
      '不要用于：临时任务进度、会话结果、已完成工作日志、聊天摘要、过期标识符、文件内容、密钥，以及 SOUL.md（身份策略仅用户可编辑）。',
      '需要人工批准的项目结论、设计决策、证据链请用 propose_memory（存 MemoryCatalog，批准后才生效）；不要把结论堆进全局快照。',
      '写入即落盘；system prompt 使用会话开始时的 USER.md/MEMORY.md 快照，本工具每次编辑后返回最新条目。',
    ].join('\n'),
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['memory', 'user'], description: '编辑目标：memory 编辑 MEMORY.md，user 编辑 USER.md。' },
        action: { type: 'string', enum: ['add', 'replace', 'remove'], description: '编辑动作。' },
        content: { type: 'string', description: 'add 与 replace 必填；replace 时作为整条替换内容。' },
        old_text: { type: 'string', description: 'replace 与 remove 必填；仅用于按子串定位条目。' },
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

async function catchToolSourceError<T>(source: string, factory: () => Promise<T>, logger: ILogger): Promise<T> {
  try {
    return await factory()
  }
  catch (error) {
    logger.warn(`工具源 ${source} 初始化失败，已剔除该源工具`, error)
    return [] as unknown as T
  }
}

function catchToolSourceErrorSync<T>(source: string, factory: () => T, logger: ILogger): T {
  try {
    return factory()
  }
  catch (error) {
    logger.warn(`工具源 ${source} 初始化失败，已剔除该源工具`, error)
    return [] as unknown as T
  }
}

// native 工具失败维持熔断，不做捕错剔除；构造器 description/inputSchema 校验保留。

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

/** 合并后的技能条目：origin 决定读取位置（全局技能根 vs 当前工作区 `.agents/skills`）。 */
interface ResolvedSkillEntry {
  manifest: SkillManifest
  origin: 'global' | 'workspace'
}

/** 计算本 Turn 可见技能：全局 enabled + 当前工作区技能（工作区同名覆盖全局），自动化再按 allowedSkills 过滤。 */
async function resolveSkillEntriesForTurn(
  reader: SkillReader,
  workspacePath: string,
  turnSource?: AgentTurnSource,
): Promise<ResolvedSkillEntry[]> {
  const globalSkills = await reader.getEnabledSkills()
  const byName = new Map<string, ResolvedSkillEntry>(
    globalSkills.map(manifest => [manifest.name, { manifest, origin: 'global' }]),
  )
  let workspaceSkills: SkillManifest[] = []
  try {
    workspaceSkills = await reader.listWorkspaceSkills(workspacePath)
  }
  catch {
    // 工作区技能读取失败不影响全局技能。
  }
  for (const manifest of workspaceSkills) {
    // 工作区优先：同名覆盖全局版本。
    byName.set(manifest.name, { manifest, origin: 'workspace' })
  }

  let entries = [...byName.values()]
  if (turnSource?.type === 'automation') {
    const allowed = new Set(turnSource.allowedSkills.map(name => name.trim()).filter(Boolean))
    entries = entries.filter(entry => allowed.has(entry.manifest.name))
  }
  entries.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name, 'en'))
  return entries
}

/** 技能来源的根目录（全局技能根 vs 当前工作区 `.agents/skills`），供 listSkillFiles 拼技能名。 */
function skillRootForEntry(reader: SkillReader, entry: ResolvedSkillEntry, workspacePath: string): string {
  return entry.origin === 'workspace'
    ? path.join(workspacePath, WORKSPACE_SKILLS_DIR)
    : reader.getSkillsRoot()
}

/** 按来源读取技能的 SKILL.md 全文。 */
function readSkillContentForEntry(reader: SkillReader, entry: ResolvedSkillEntry, workspacePath: string): Promise<string> {
  return entry.origin === 'workspace'
    ? reader.readWorkspaceSkillMarkdown(workspacePath, entry.manifest.name)
    : reader.readSkillMarkdown(entry.manifest.name)
}

async function makeSkillTools(
  reader: SkillReader,
  workspacePath: string,
  entries: ResolvedSkillEntry[],
  turnSource?: AgentTurnSource,
): Promise<AgentTool[]> {
  if (turnSource?.type === 'automation') {
    if (entries.length === 0) {
      return []
    }
    const capabilities = await Promise.all(entries.map(async (entry): Promise<ResolvedSkillCapability> => ({
      manifest: entry.manifest,
      content: await readSkillContentForEntry(reader, entry, workspacePath),
      files: await listSkillFiles(skillRootForEntry(reader, entry, workspacePath), entry.manifest.name),
    })))
    const tools: AgentTool[] = [createResolvedUseSkillTool(capabilities)]
    if (entries.some(entry => entry.manifest.name === 'visualize' && entry.manifest.enabled)) {
      tools.push(createPublishVisualizationTool())
    }
    return tools
  }
  const tools: AgentTool[] = [
    createUseSkillTool(reader, workspacePath, entries),
    createInstallSkillFromGithubTool(reader),
  ]
  if (entries.some(entry => entry.manifest.name === 'visualize' && entry.manifest.enabled)) {
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

function createUseSkillTool(skillReader: SkillReader, workspacePath: string, entries: ResolvedSkillEntry[]): AgentTool {
  const enabled = entries.filter(entry => entry.manifest.enabled)
  const entryByName = new Map(enabled.map(entry => [entry.manifest.name, entry]))
  const tool = createUseSkillToolDefinition(enabled.map(entry => entry.manifest))
  return {
    ...tool,
    execute: async (input) => {
      const name = String(input.name || '').trim()
      const entry = entryByName.get(name)
      if (!entry) {
        return { ok: false, result: formatSkillError(new Error('AGENT_SKILL_INVALID: skill not found')) }
      }
      try {
        const content = await readSkillContentForEntry(skillReader, entry, workspacePath)
        const files = await listSkillFiles(skillRootForEntry(skillReader, entry, workspacePath), name)
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
