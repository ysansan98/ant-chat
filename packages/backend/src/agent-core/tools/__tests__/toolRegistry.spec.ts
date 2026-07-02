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
})
