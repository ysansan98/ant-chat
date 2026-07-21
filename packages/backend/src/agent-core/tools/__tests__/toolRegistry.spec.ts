import type { AgentRuntimeConfig, IAgentEventEmitter, RuntimeMcpClientHub, SkillManifest, SkillReader } from '@ant-chat/shared'
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

  function createConfig(): AgentRuntimeConfig {
    const eventEmitter: IAgentEventEmitter = {
      emitTaskUpdated: vi.fn(),
      emitApprovalRequired: vi.fn(),
      emitTurnStarted: vi.fn(),
      emitTurnChunk: vi.fn(),
      emitTurnToolCalls: vi.fn(),
      emitTurnFinished: vi.fn(),
    }
    return { eventEmitter, skillReader: createSkillReader() }
  }

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
          allowBashCommands: false,
          bashCommandPatterns: [],
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
          allowBashCommands: false,
          bashCommandPatterns: [],
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
          allowBashCommands: false,
          bashCommandPatterns: [],
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
          allowBashCommands: false,
          bashCommandPatterns: [],
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
    expect(registry.prepare('bash', { command: `node ${path.join(skillsRoot, 'review', 'scripts', 'run.js')}` }).scope).toBe('outside')
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
        allowBashCommands: false,
        bashCommandPatterns: [],
      },
    })

    const deniedRegistry = await ToolRegistry.create({ config, mode: 'hybrid', turnSource: createTurnSource(false), workspacePath })
    expect(deniedRegistry.listTools().some(tool => tool.name === 'browser')).toBe(false)

    const allowedRegistry = await ToolRegistry.create({ config, mode: 'hybrid', turnSource: createTurnSource(true), workspacePath })
    expect(allowedRegistry.listTools().some(tool => tool.name === 'browser')).toBe(true)
  })

  it('普通交互 Turn 将严格只读 Bash 标记为 bash_read', async () => {
    const registry = await ToolRegistry.create({
      config: createConfig(),
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath,
    })

    expect(registry.prepare('bash', { command: 'which node && node --version' })).toMatchObject({
      operationType: 'bash_read',
      scope: 'workspace',
    })
    expect(registry.prepare('bash', { command: 'node -v --run build' })).toMatchObject({
      operationType: 'bash',
      scope: 'workspace',
    })
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
        allowBashCommands: false,
        bashCommandPatterns: [],
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
