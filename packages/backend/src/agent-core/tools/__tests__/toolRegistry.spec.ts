import type { AgentCommandHost, AgentRuntimeConfig, AgentTool, CommandInterpreter, IAgentEventEmitter, RuntimeMcpClientHub, SecretRef, SkillManifest, SkillReader } from '@ant-chat/shared'
import { DEFAULT_MCP_TOOL_NAME_SEPARATOR } from '@ant-chat/shared'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../toolRegistry'

describe('toolRegistry Skill 白名单', () => {
  let skillsRoot: string
  let workspacePath: string

  beforeEach(async () => {
    skillsRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-tool-registry-'))
    workspacePath = mkdtempSync(path.join(tmpdir(), 'ant-chat-tool-registry-workspace-'))
    await mkdir(path.join(skillsRoot, 'review'), { recursive: true })
    await mkdir(path.join(skillsRoot, 'deploy'), { recursive: true })
    writeFileSync(path.join(skillsRoot, 'review', 'SKILL.md'), '# Review\n')
    writeFileSync(path.join(skillsRoot, 'deploy', 'SKILL.md'), '# Deploy\n')
  })

  afterEach(() => {
    rmSync(skillsRoot, { recursive: true, force: true })
    rmSync(workspacePath, { recursive: true, force: true })
  })

  function createSkillReader(): SkillReader {
    const skills: SkillManifest[] = [
      { name: 'review', description: '代码审查', enabled: true, builtin: false, source: 'zip', installedAt: 1, updatedAt: 1 },
      { name: 'deploy', description: '发布部署', enabled: true, builtin: false, source: 'zip', installedAt: 1, updatedAt: 1 },
    ]
    return {
      getSkillsRoot: () => skillsRoot,
      getEnabledSkills: vi.fn(async () => skills),
      readSkillMarkdown: vi.fn(async name => `# ${name}`),
      importFromGithub: vi.fn(),
    }
  }

  function createConfig(commandHost: AgentCommandHost = createCommandHost('bash')): AgentRuntimeConfig {
    const eventEmitter: IAgentEventEmitter = {
      emitTaskUpdated: vi.fn(),
      emitApprovalRequired: vi.fn(),
      emitTurnStarted: vi.fn(),
      emitTurnChunk: vi.fn(),
      emitTurnToolCalls: vi.fn(),
      emitTurnFinished: vi.fn(),
    }
    return { commandHost, eventEmitter, skillReader: createSkillReader() }
  }

  function createCommandHost(interpreter: CommandInterpreter): Extract<AgentCommandHost, { status: 'available' }> {
    if (interpreter === 'bash') {
      return {
        status: 'available',
        platform: 'posix',
        adapter: 'bash',
        interpreter,
        executablePath: '/bin/bash',
        environment: { PATH: process.env.PATH ?? '', HOME: workspacePath },
      }
    }
    return {
      status: 'available',
      platform: 'windows',
      adapter: 'windows',
      interpreter,
      executablePath: `C:\\tools\\${interpreter}.exe`,
      environment: { PATH: 'C:\\tools', SystemRoot: 'C:\\Windows', ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
    }
  }

  it.each([
    ['bash', '当前解释器：Bash。', '$NAME'],
    ['powershell7', '当前解释器：PowerShell 7（pwsh.exe）。', '$env:NAME'],
    ['windows-powershell', '当前解释器：Windows PowerShell（powershell.exe）。', '$env:NAME'],
    ['cmd', '当前解释器：CMD（cmd.exe）。', '%NAME%'],
  ] as const)('$interpreter 宿主只注册统一命令工具并给出对应语法说明', async (interpreter, title, syntax) => {
    const registry = await ToolRegistry.create({
      config: createConfig(createCommandHost(interpreter)),
      workspacePath,
      mode: 'strict',
      turnSource: { type: 'interactive' },
    })
    const tools = registry.listTools()
    const commandTools = tools.filter(tool => tool.name === 'execute_command')

    expect(commandTools).toHaveLength(1)
    expect(tools.some(tool => tool.name === 'bash' || tool.name === 'windows_command')).toBe(false)
    expect(commandTools[0]?.description).toContain(title)
    expect(commandTools[0]?.description).toContain(syntax)
  })

  it('bash 与 Windows adapter 对模型暴露完全相同的 input schema', async () => {
    const registries = await Promise.all(
      (['bash', 'powershell7', 'windows-powershell', 'cmd'] as const).map(interpreter => ToolRegistry.create({
        config: createConfig(createCommandHost(interpreter)),
        workspacePath,
        mode: 'strict',
        turnSource: { type: 'interactive' },
      })),
    )
    const schemas = registries.map(registry =>
      registry.listTools().find(tool => tool.name === 'execute_command')?.inputSchema,
    )

    expect(schemas.every(schema => schema !== undefined)).toBe(true)
    expect(schemas.slice(1)).toEqual(schemas.slice(1).map(() => schemas[0]))
    expect(schemas[0]).toMatchObject({
      required: ['command'],
      properties: {
        command: expect.any(Object),
        description: expect.any(Object),
        cwd: expect.any(Object),
        timeoutMs: expect.any(Object),
        secretEnv: expect.any(Object),
      },
    })
  })

  it('命令宿主不可用时不向当前 Turn 注册命令工具', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig({
        status: 'unavailable',
        platform: 'windows',
        candidates: ['pwsh.exe', 'powershell.exe', 'cmd.exe'],
        reason: '未找到可用解释器',
      }),
      workspacePath,
      mode: 'strict',
      turnSource: { type: 'interactive' },
    })

    expect(registry.listTools().some(tool => tool.name === 'execute_command')).toBe(false)
  })

  it('自动化运行只注入选中的 Skill，并在创建 Turn 时固化内容', async () => {
    const config = createConfig()
    const registry = await ToolRegistry.create({
      config,
      workspacePath,
      mode: 'strict',
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: ['review'],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowBrowser: false,
          allowMcpTools: false,
          extraFileRoots: [],
          allowCommandExecution: false,
          commandPatterns: [],
        },
      },
    })

    const useSkill = registry.listTools().find(tool => tool.name === 'use_skill')
    expect(useSkill?.description).toContain('review')
    expect(useSkill?.description).not.toContain('deploy')
    expect(registry.listTools().some(tool => tool.name === 'install_skill_from_github')).toBe(false)

    const skillReader = config.skillReader as SkillReader
    expect(skillReader.readSkillMarkdown).toHaveBeenCalledOnce()
    await expect(registry.prepare('use_skill', { name: 'review' }).execute()).resolves.toEqual(expect.objectContaining({ ok: true, result: expect.stringContaining('# review') }))
    expect(skillReader.readSkillMarkdown).toHaveBeenCalledOnce()

    await expect(registry.prepare('use_skill', { name: 'deploy' }).execute()).resolves.toEqual({ ok: false, result: '技能加载失败：当前执行未注入该 Skill' })
    expect(skillReader.readSkillMarkdown).toHaveBeenCalledOnce()
  })

  it('自动化未选择 Skill 时不注册 use_skill 工具', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig(),
      workspacePath,
      mode: 'strict',
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: [],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowBrowser: false,
          allowMcpTools: false,
          extraFileRoots: [],
          allowCommandExecution: false,
          commandPatterns: [],
        },
      },
    })

    expect(registry.listTools().some(tool => tool.name === 'use_skill')).toBe(false)
  })

  it('自动化仅在开启运行所选 Skills 时信任已选 Skill 根目录', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig(),
      workspacePath,
      mode: 'strict',
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: ['review'],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: true,
          allowBrowser: false,
          allowMcpTools: false,
          extraFileRoots: [],
          allowCommandExecution: false,
          commandPatterns: [],
        },
      },
    })

    expect(registry.prepare('read_file', { path: path.join(skillsRoot, 'review', 'SKILL.md') }).scope).toBe('workspace')
    expect(registry.prepare('read_file', { path: path.join(skillsRoot, 'deploy', 'SKILL.md') }).scope).toBe('outside')
  })

  it('自动化未开启运行所选 Skills 时不把已选 Skill 根目录视为工作区范围', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig(),
      workspacePath,
      mode: 'strict',
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        allowedSkills: ['review'],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSelectedSkillRuntime: false,
          allowBrowser: false,
          allowMcpTools: false,
          extraFileRoots: [],
          allowCommandExecution: false,
          commandPatterns: [],
        },
      },
    })

    expect(registry.prepare('read_file', { path: path.join(skillsRoot, 'review', 'SKILL.md') }).scope).toBe('outside')
  })

  it('普通交互 Turn 不继承自动化限制并重新提供当前可用 Skill', async () => {
    const config = createConfig()
    const registry = await ToolRegistry.create({
      config,
      workspacePath,
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
    })

    const useSkill = registry.listTools().find(tool => tool.name === 'use_skill')
    expect(useSkill?.description).toContain('review')
    expect(useSkill?.description).toContain('deploy')
    expect(registry.listTools().some(tool => tool.name === 'install_skill_from_github')).toBe(true)

    await expect(registry.prepare('use_skill', { name: 'deploy' }).execute()).resolves.toEqual(expect.objectContaining({ ok: true, result: expect.stringContaining('# deploy') }))
    expect(config.skillReader?.readSkillMarkdown).toHaveBeenCalledWith('deploy')
  })

  it('普通交互 Turn 不把 Skill 安装目录纳入工作区权限', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig(),
      workspacePath,
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
    })

    expect(registry.prepare('read_file', { path: path.join(skillsRoot, 'review', 'SKILL.md') }).scope).toBe('outside')
    expect(registry.prepare('execute_command', { command: `node ${path.join(skillsRoot, 'review', 'scripts', 'run.js')}` }).scope).toBe('outside')
  })

  it('普通交互 Turn 不注册 ant_chat 工具', async () => {
    const config = createConfig()
    const registry = await ToolRegistry.create({
      config,
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
    })

    expect(registry.listTools().some(tool => tool.name === 'ant_chat')).toBe(false)
  })

  it('自动化只在显式授权后注入浏览器能力', async () => {
    const config = {
      ...createConfig(),
      browser: { profilePath: '/tmp/profile', artifactsPath: '/tmp/artifacts' },
    }
    const createTurnSource = (allowBrowser: boolean) => ({
      type: 'automation' as const,
      automationId: 'automation-1',
      runId: 'run-1',
      allowedSkills: [],
      allowedMcpServers: [],
      permissionPolicy: {
        workspaceAccess: 'read' as const,
        allowSelectedSkillRuntime: false,
        allowBrowser,
        allowMcpTools: false,
        extraFileRoots: [],
        allowCommandExecution: false,
        commandPatterns: [],
      },
    })

    const deniedRegistry = await ToolRegistry.create({ config, mode: 'hybrid', turnSource: createTurnSource(false), workspacePath })
    expect(deniedRegistry.listTools().some(tool => tool.name.startsWith('browser_'))).toBe(false)

    const allowedRegistry = await ToolRegistry.create({ config, mode: 'hybrid', turnSource: createTurnSource(true), workspacePath })
    expect(allowedRegistry.listTools().some(tool => tool.name.startsWith('browser_'))).toBe(true)
  })

  it('普通交互 Turn 将严格只读命令标记为 command_read', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig(),
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
    })

    expect(registry.prepare('execute_command', { command: 'which node && node --version' })).toMatchObject({
      operationType: 'command_read',
      scope: 'workspace',
    })
    expect(registry.prepare('execute_command', { command: 'node -v --run build' })).toMatchObject({
      operationType: 'command',
      scope: 'workspace',
    })
  })

  it('命令输入校验失败时不进入 canonical prepare', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig(),
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
    })

    expect(() => registry.prepare('execute_command', {})).not.toThrow()
    expect(registry.prepare('execute_command', {})).toMatchObject({
      validationError: 'command 必须是非空字符串',
      scope: 'blocked',
      preparedState: undefined,
    })
  })

  it('命令工具只公开 secretEnv，拒绝旧 env、字符串秘密和 PATH', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig(),
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
    })
    const commandTool = registry.listTools().find(tool => tool.name === 'execute_command')
    const secretRef: SecretRef = { kind: 'secret_ref', id: 'turn:run-1:secret-1', scope: 'turn' }

    expect(commandTool?.inputSchema.properties).toHaveProperty('secretEnv')
    expect(commandTool?.inputSchema.properties).not.toHaveProperty('env')
    expect(registry.prepare('execute_command', { command: 'printf ok', env: { TOKEN: secretRef } }).validationError)
      .toContain('env')
    expect(registry.prepare('execute_command', { command: 'printf ok', secretEnv: { TOKEN: 'literal-secret' } }).validationError)
      .toContain('SecretRef')
    expect(registry.prepare('execute_command', { command: 'printf ok', secretEnv: { PATH: secretRef } }).validationError)
      .toContain('PATH')
  })

  it('秘密请求只指导模型使用平台中立的命令工具', async () => {
    const registry = await ToolRegistry.create({
      config: {
        ...createConfig(),
        secretRequester: {
          requestSecret: vi.fn(),
          resolveSecretRequest: vi.fn(),
          rejectSecretRequest: vi.fn(),
        },
      },
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
    })
    const requestSecret = registry.listTools().find(tool => tool.name === 'requestSecret')

    expect(requestSecret?.description).toContain('execute_command.secretEnv')
    expect(requestSecret?.description).not.toContain('bash.secretEnv')
  })

  it('注入 messageSearch/memoryCatalog 后暴露五个搜索与记忆工具，且不再有 memory 工具', async () => {
    const registry = await ToolRegistry.create({
      config: {
        ...createConfig(),
        messageSearch: { search: vi.fn(), getThread: vi.fn(), getTurn: vi.fn() },
        memoryCatalog: { search: vi.fn(), propose: vi.fn(), approve: vi.fn(), archive: vi.fn() },
      },
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
    })
    const names = registry.listTools().map(tool => tool.name)

    expect(names).toEqual(expect.arrayContaining([
      'search_messages',
      'get_thread',
      'get_turn',
      'search_memories',
      'propose_memory',
    ]))
    // agent 不再直接编辑 USER/MEMORY.md（长期记忆只允许用户确认后写入）
    expect(names).not.toContain('memory')
  })

  it('自动化 turn 执行 propose_memory 时被拒绝', async () => {
    const registry = await ToolRegistry.create({
      config: {
        ...createConfig(),
        memoryCatalog: { search: vi.fn(), propose: vi.fn(), approve: vi.fn(), archive: vi.fn() },
      },
      mode: 'hybrid',
      turnSource: {
        type: 'automation',
        automationId: 'auto-1',
        runId: 'run-1',
        allowedSkills: [],
        allowedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowBrowser: false,
          allowMcpTools: false,
          extraFileRoots: [],
          allowSelectedSkillRuntime: false,
          allowCommandExecution: false,
          commandPatterns: [],
        },
      },
      workspacePath,
    })

    const prepared = registry.prepare('propose_memory', {
      title: 't',
      summary: 's',
      body: 'b',
      evidence_message_ids: ['m-1'],
    })
    const result = await prepared.execute()

    expect(result.ok).toBe(false)
    expect(result.result).toContain('自动化')
  })

  it('只解析命令工具的 secretEnv，并在执行结果中脱敏真实秘密', async () => {
    const secret = 'registry-secret-value'
    const secretRef: SecretRef = { kind: 'secret_ref', id: 'turn:run-1:secret-1', scope: 'turn' }
    const secretStore: NonNullable<AgentRuntimeConfig['secretStore']> = {
      saveProviderApiKey: vi.fn(),
      getProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
      saveMcpOAuthCredential: vi.fn(),
      getMcpOAuthCredential: vi.fn(),
      deleteMcpOAuthCredential: vi.fn(),
      createTurnSecret: vi.fn(),
      resolveTurnSecret: vi.fn(async () => secret),
      resolve: vi.fn(async () => secret),
      clearTurnSecrets: vi.fn(),
    }
    const registry = await ToolRegistry.create({
      config: { ...createConfig(), secretStore },
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
      runId: 'run-1',
    })

    const prepared = registry.prepare('execute_command', {
      command: `${process.execPath} -e "process.stdout.write(process.env.ANT_CHAT_TOKEN || '')"`,
      secretEnv: { ANT_CHAT_TOKEN: secretRef },
    })
    const result = await prepared.execute()

    expect(secretStore.resolveTurnSecret).toHaveBeenCalledWith(secretRef, 'run-1')
    expect(secretStore.resolve).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, diagnostics: { stdout: '[secret]' } })
    expect(result.result).toContain('[secret]')
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  it('命令工具拒绝解析其他 Turn 的 SecretRef', async () => {
    const secretRef: SecretRef = { kind: 'secret_ref', id: 'turn:run-2:secret-1', scope: 'turn' }
    const secretStore: NonNullable<AgentRuntimeConfig['secretStore']> = {
      saveProviderApiKey: vi.fn(),
      getProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
      saveMcpOAuthCredential: vi.fn(),
      getMcpOAuthCredential: vi.fn(),
      deleteMcpOAuthCredential: vi.fn(),
      createTurnSecret: vi.fn(),
      resolveTurnSecret: vi.fn(async () => null),
      resolve: vi.fn(),
      clearTurnSecrets: vi.fn(),
    }
    const registry = await ToolRegistry.create({
      config: { ...createConfig(), secretStore },
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
      runId: 'run-1',
    })

    const result = await registry.prepare('execute_command', {
      command: 'printf ok',
      secretEnv: { TOKEN: secretRef },
    }).execute()

    expect(result).toMatchObject({ ok: false })
    expect(secretStore.resolveTurnSecret).toHaveBeenCalledWith(secretRef, 'run-1')
  })

  it('非命令工具收到 SecretRef 时不由 ToolRegistry 解析', async () => {
    const secretRef: SecretRef = { kind: 'secret_ref', id: 'secret-1', scope: 'turn' }
    const execute = vi.fn(async () => ({ ok: true, result: 'ok' }))
    const tool: AgentTool = {
      name: 'demo',
      source: 'skill',
      description: '测试工具',
      inputSchema: {
        type: 'object',
        properties: { credential: { type: 'object' } },
        required: ['credential'],
      },
      operationType: 'skill',
      inferScope: () => 'workspace',
      execute,
    }
    const secretStore: NonNullable<AgentRuntimeConfig['secretStore']> = {
      saveProviderApiKey: vi.fn(),
      getProviderApiKey: vi.fn(),
      deleteProviderApiKey: vi.fn(),
      saveMcpOAuthCredential: vi.fn(),
      getMcpOAuthCredential: vi.fn(),
      deleteMcpOAuthCredential: vi.fn(),
      createTurnSecret: vi.fn(),
      resolve: vi.fn(async () => '不应解析'),
      clearTurnSecrets: vi.fn(),
    }
    const registry = new ToolRegistry([tool])

    await registry.prepare('demo', { credential: secretRef }).execute()

    expect(secretStore.resolve).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledWith({ credential: secretRef })
  })

  it('自动化只在显式授权后注入所选 MCP 服务的工具', async () => {
    const mcpClientHub: RuntimeMcpClientHub = {
      connections: [{
        server: {
          name: 'github',
          status: 'connected',
          tools: [{ name: 'list_issues', description: '列出 issue', inputSchema: { type: 'object', properties: {}, required: [] } }],
        },
      }, {
        server: {
          name: 'slack',
          status: 'connected',
          tools: [{ name: 'send_message', description: '发送消息', inputSchema: { type: 'object', properties: {}, required: [] } }],
        },
      }],
      callTool: vi.fn(),
    }
    const createTurnSource = (allowMcpTools: boolean) => ({
      type: 'automation' as const,
      automationId: 'automation-1',
      runId: 'run-1',
      allowedSkills: [],
      allowedMcpServers: ['github'],
      permissionPolicy: {
        workspaceAccess: 'read' as const,
        allowSelectedSkillRuntime: false,
        allowBrowser: false,
        allowMcpTools,
        extraFileRoots: [],
        allowCommandExecution: false,
        commandPatterns: [],
      },
    })
    const config = { ...createConfig(), mcpClientHub }

    const deniedRegistry = await ToolRegistry.create({ config, mode: 'strict', turnSource: createTurnSource(false), workspacePath })
    expect(deniedRegistry.listTools().some(tool => tool.source === 'mcp')).toBe(false)

    const allowedRegistry = await ToolRegistry.create({ config, mode: 'strict', turnSource: createTurnSource(true), workspacePath })
    expect(allowedRegistry.listTools()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: `github${DEFAULT_MCP_TOOL_NAME_SEPARATOR}list_issues` }),
    ]))
    expect(allowedRegistry.listTools().some(tool => tool.name.includes('slack'))).toBe(false)
  })

  it('mcp 工具统一标记为外部资源且不信任服务端副作用提示', async () => {
    const mcpClientHub: RuntimeMcpClientHub = {
      connections: [{
        server: {
          name: 'github',
          status: 'connected',
          tools: [{
            name: 'list_issues',
            description: '列出 issue',
            inputSchema: { type: 'object', properties: {}, required: [] },
          }, {
            name: 'create_issue',
            description: '创建 issue',
            inputSchema: { type: 'object', properties: {}, required: [] },
          }],
        },
      }],
      callTool: vi.fn(),
    }
    const registry = await ToolRegistry.create({
      config: { ...createConfig(), mcpClientHub },
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
    })

    expect(registry.listTools()).toContainEqual(expect.objectContaining({
      name: `github${DEFAULT_MCP_TOOL_NAME_SEPARATOR}list_issues`,
      serverName: 'github',
      source: 'mcp',
    }))
    expect(registry.prepare(`github${DEFAULT_MCP_TOOL_NAME_SEPARATOR}list_issues`, {})).toMatchObject({ operationType: 'mcp', scope: 'external' })
    expect(registry.prepare(`github${DEFAULT_MCP_TOOL_NAME_SEPARATOR}create_issue`, {})).toMatchObject({ operationType: 'mcp', scope: 'external' })
  })
})
