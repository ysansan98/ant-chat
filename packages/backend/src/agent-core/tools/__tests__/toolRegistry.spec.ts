import type { AgentRuntimeConfig, IAgentEventEmitter, SkillManifest, SkillReader } from '@ant-chat/shared'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolRegistry } from '../toolRegistry'

describe('toolRegistry Skill 白名单', () => {
  let skillsRoot: string

  beforeEach(async () => {
    skillsRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-tool-registry-'))
    await mkdir(path.join(skillsRoot, 'review'), { recursive: true })
    await mkdir(path.join(skillsRoot, 'deploy'), { recursive: true })
    writeFileSync(path.join(skillsRoot, 'review', 'SKILL.md'), '# Review\n')
    writeFileSync(path.join(skillsRoot, 'deploy', 'SKILL.md'), '# Deploy\n')
  })

  afterEach(() => {
    rmSync(skillsRoot, { recursive: true, force: true })
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
      workspacePath: '/workspace',
      mode: 'strict',
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        selectedSkills: ['review'],
        selectedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSkillScripts: false,
          allowMcpMutations: false,
          extraFileRoots: [],
          allowArbitraryCommands: false,
          commandPatterns: [],
          allowNetwork: false,
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
      workspacePath: '/workspace',
      mode: 'strict',
      turnSource: {
        type: 'automation',
        automationId: 'automation-1',
        runId: 'run-1',
        selectedSkills: [],
        selectedMcpServers: [],
        permissionPolicy: {
          workspaceAccess: 'read',
          allowSkillScripts: false,
          allowMcpMutations: false,
          extraFileRoots: [],
          allowArbitraryCommands: false,
          commandPatterns: [],
          allowNetwork: false,
        },
      },
    })

    expect(registry.listTools().some(tool => tool.name === 'use_skill')).toBe(false)
  })

  it('普通交互 Turn 不继承自动化限制并重新提供当前可用 Skill', async () => {
    const config = createConfig()
    const registry = await ToolRegistry.create({
      config,
      workspacePath: '/workspace',
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

  it('ant_chat 使用敏感信息工具返回的完整 SecretRef 设置 API Key', async () => {
    const appControl = { execute: vi.fn(async () => ({ hasApiKey: true, id: 'provider-1' })) }
    const config = {
      ...createConfig(),
      appControl,
      secretStore: {
        clearTurnSecrets: vi.fn(),
        createTurnSecret: vi.fn(),
        deleteProviderApiKey: vi.fn(),
        getProviderApiKey: vi.fn(),
        resolve: vi.fn(async () => 'sk-secret'),
        saveProviderApiKey: vi.fn(),
      },
    } as unknown as AgentRuntimeConfig
    const registry = await ToolRegistry.create({
      config,
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath: '/workspace',
    })

    const result = await registry.prepare('ant_chat', {
      action: 'key:set',
      id: 'provider-1',
      secretRef: { id: 'turn:task-1:secret-1', kind: 'secret_ref', scope: 'turn' },
      type: 'provider',
    }).execute()

    expect(result.ok).toBe(true)
    expect(appControl.execute).toHaveBeenCalledWith({
      action: 'key:set',
      apiKey: 'sk-secret',
      id: 'provider-1',
      type: 'provider',
    })
  })

  it('ant_chat 拒绝 Agent 在 provider 命令中直接提交 API Key', async () => {
    const config = { ...createConfig(), appControl: { execute: vi.fn() } } as AgentRuntimeConfig
    const registry = await ToolRegistry.create({
      config,
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath: '/workspace',
    })

    const prepared = registry.prepare('ant_chat', {
      action: 'create',
      apiKey: 'sk-plaintext',
      apiMode: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      name: 'OpenAI',
      type: 'provider',
    })

    expect(prepared.validationError).toContain('不得直接提交 apiKey')
  })

  it('ant_chat 在执行前解析 MCP 凭据但不改变其明文持久化语义', async () => {
    const appControl = { execute: vi.fn(async () => ({ mcpServer: { name: 'remote', status: 'connected' } })) }
    const config = {
      ...createConfig(),
      appControl,
      secretStore: {
        clearTurnSecrets: vi.fn(),
        createTurnSecret: vi.fn(),
        deleteProviderApiKey: vi.fn(),
        getProviderApiKey: vi.fn(),
        resolve: vi.fn(async () => 'Bearer mcp-token'),
        saveProviderApiKey: vi.fn(),
      },
    } as unknown as AgentRuntimeConfig
    const registry = await ToolRegistry.create({
      config,
      mode: 'hybrid',
      turnSource: { type: 'interactive' },
      workspacePath: '/workspace',
    })

    await registry.prepare('ant_chat', {
      action: 'install',
      headers: {
        Authorization: { id: 'turn:task-1:secret-2', kind: 'secret_ref', scope: 'turn' },
      },
      serverName: 'remote',
      transportType: 'sse',
      type: 'mcp',
      url: 'https://example.com/mcp',
    }).execute()

    expect(appControl.execute).toHaveBeenCalledWith(expect.objectContaining({
      headers: { Authorization: 'Bearer mcp-token' },
    }))
  })

  it('自动化 Turn 不注册 ant_chat 工具', async () => {
    const config = { ...createConfig(), appControl: { execute: vi.fn() } } as AgentRuntimeConfig
    const registry = await ToolRegistry.create({
      config,
      mode: 'strict',
      turnSource: {
        automationId: 'automation-1',
        permissionPolicy: {
          allowArbitraryCommands: false,
          allowMcpMutations: false,
          allowNetwork: false,
          allowSkillScripts: false,
          commandPatterns: [],
          extraFileRoots: [],
          workspaceAccess: 'read',
        },
        runId: 'run-1',
        selectedMcpServers: [],
        selectedSkills: [],
        type: 'automation',
      },
      workspacePath: '/workspace',
    })

    expect(registry.listTools().some(tool => tool.name === 'ant_chat')).toBe(false)
  })
})
