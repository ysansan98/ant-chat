import type { SecretStore } from '@ant-chat/shared'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AgentCommandPaths } from '../../../../agentCommands'
import type { AvailableCommandHost } from '../types'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundCommandManager } from '../backgroundCommandManager'
import { createBackgroundCommandTools } from '../backgroundCommandTools'
import { createCommandTool } from '../commandTool'

let workspacePath: string
let root: string
let paths: AgentCommandPaths

const host: AvailableCommandHost = {
  status: 'available',
  platform: 'posix',
  adapter: 'bash',
  interpreter: 'bash',
  executablePath: '/fixed/bin/bash',
  environment: { PATH: '/fixed/bin', HOME: '/home/user' },
}

beforeEach(() => {
  workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-ws-'))
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-cmd-'))
  paths = { root, logsPath: path.join(root, 'logs'), statePath: path.join(root, 'state') }
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(workspacePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

function createChild(pid = 7001): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  child.stdout = new PassThrough() as ChildProcessWithoutNullStreams['stdout']
  child.stderr = new PassThrough() as ChildProcessWithoutNullStreams['stderr']
  child.kill = vi.fn(() => true)
  Object.assign(child, { pid })
  return child
}

function createManager(child: ChildProcessWithoutNullStreams, extra: Record<string, unknown> = {}) {
  return new BackgroundCommandManager(paths, { spawnProcess: () => child, killGraceMs: 5, ...extra })
}

describe('execute_command.runInBackground 契约', () => {
  it('runInBackground 必须是布尔值', () => {
    const tool = createCommandTool(workspacePath, false, host)
    expect(tool.validateInput?.({ command: 'pnpm dev', runInBackground: 'yes' })).toContain('runInBackground')
    expect(tool.validateInput?.({ command: 'pnpm dev', runInBackground: true })).toBeNull()
  })

  it('后台模式立即返回 commandId 与日志路径，不等待进程退出', async () => {
    const child = createChild()
    const manager = createManager(child)
    const tool = createCommandTool(workspacePath, false, host, { backgroundCommands: manager, conversationId: 'conv-1' })

    const result = await tool.execute({ command: 'pnpm dev', runInBackground: true })

    expect(result.ok).toBe(true)
    expect(result.diagnostics?.commandId).toMatch(/^cmd-/)
    expect(result.diagnostics?.status).toBe('running')
    expect(result.diagnostics?.logPath).toBeDefined()
    expect(manager.list('conv-1')).toHaveLength(1)
  })

  it('显式 timeoutMs 作为后台看门狗', async () => {
    const child = createChild(8123)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const manager = createManager(child)
    const tool = createCommandTool(workspacePath, false, host, { backgroundCommands: manager, conversationId: 'conv-1' })

    await tool.execute({ command: 'pnpm dev', runInBackground: true, timeoutMs: 20 })

    await new Promise(resolve => setTimeout(resolve, 60))
    expect(killSpy).toHaveBeenCalledWith(-8123, 'SIGTERM')
  })

  it('secretEnv 后台进程带审计标记，日志输出脱敏', async () => {
    const child = createChild()
    const manager = createManager(child)
    const secretStore = { resolveTurnSecret: async () => 'super-secret-value' } as unknown as SecretStore
    const tool = createCommandTool(workspacePath, true, host, {
      backgroundCommands: manager,
      conversationId: 'conv-1',
      secretStore,
      runId: 'turn-1',
    })

    const result = await tool.execute({
      command: 'curl https://example.com',
      runInBackground: true,
      secretEnv: { TOKEN: { kind: 'secret_ref', id: 'secret-1', scope: 'turn' } },
    })
    expect(result.ok).toBe(true)

    const summary = manager.list('conv-1')[0]
    expect(summary.hasSecretEnv).toBe(true)
    expect(summary.secretEnvKeys).toEqual(['TOKEN'])

    ;(child.stdout as PassThrough).write('token=super-secret-value\n')
    await new Promise(resolve => setTimeout(resolve, 50))
    const log = fs.readFileSync(summary.logPath, 'utf8')
    expect(log).toContain('[secret]')
    expect(log).not.toContain('super-secret-value')
  })

  it('未提供后台管理器时明确失败', async () => {
    const tool = createCommandTool(workspacePath, false, host)
    const result = await tool.execute({ command: 'pnpm dev', runInBackground: true })
    expect(result).toMatchObject({ ok: false })
    expect(result.result).toContain('后台命令不可用')
  })
})

describe('后台命令工具', () => {
  it('read_command_output / kill_command / list_commands 按会话归属', async () => {
    const child = createChild()
    const manager = createManager(child)
    const started = manager.start('conv-1', createPreparedState(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')
    const tools = createBackgroundCommandTools({ manager, conversationId: 'conv-1' })
    const readTool = tools.find(tool => tool.name === 'read_command_output')!
    const killTool = tools.find(tool => tool.name === 'kill_command')!
    const listTool = tools.find(tool => tool.name === 'list_commands')!

    ;(child.stdout as PassThrough).write('boot\n')
    await new Promise(resolve => setTimeout(resolve, 50))
    const read = await readTool.execute({ commandId: started.summary.commandId })
    expect(read.ok).toBe(true)
    expect(read.result).toContain('boot')

    const list = await listTool.execute({})
    expect(list.result).toContain(started.summary.commandId)

    const missing = await readTool.execute({ commandId: 'cmd-missing' })
    expect(missing).toMatchObject({ ok: false })

    const foreign = createBackgroundCommandTools({ manager, conversationId: 'conv-2' })
      .find(tool => tool.name === 'read_command_output')!
    expect(await foreign.execute({ commandId: started.summary.commandId })).toMatchObject({ ok: false })

    vi.spyOn(process, 'kill').mockImplementation(() => true)
    child.emit('exit', 0)
    const killed = await killTool.execute({ commandId: started.summary.commandId })
    expect(killed.ok).toBe(true)
  })

  it('read_command_output 读到终态后消费该命令的结束通知', async () => {
    const child = createChild(7301)
    const manager = createManager(child)
    const started = manager.start('conv-1', createPreparedState(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')
    const readTool = createBackgroundCommandTools({ manager, conversationId: 'conv-1' })
      .find(tool => tool.name === 'read_command_output')!

    child.emit('exit', 0)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(manager.peekNotices('conv-1')).toHaveLength(1)

    const read = await readTool.execute({ commandId: started.summary.commandId })
    expect(read.result).toContain('status=exited')
    expect(manager.peekNotices('conv-1')).toEqual([])
  })

  it('未知 commandId 的 scope 为 blocked', () => {
    const manager = createManager(createChild())
    const tools = createBackgroundCommandTools({ manager, conversationId: 'conv-1' })
    const readTool = tools.find(tool => tool.name === 'read_command_output')!
    expect(readTool.inferScope({ commandId: 'missing' })).toBe('blocked')
    expect(readTool.validateInput?.({ commandId: '' })).toBeTruthy()
    expect(readTool.validateInput?.({ commandId: 'cmd-1', waitMs: -1 })).toBeTruthy()
  })
})

function createPreparedState() {
  return {
    kind: 'command' as const,
    interpreter: 'bash' as const,
    input: { command: 'pnpm dev' },
    command: 'pnpm dev',
    cwd: '/workspace',
    segments: [],
    resourceScope: 'workspace' as const,
    isReadOnly: false,
    hasSecretEnv: false,
    risk: 'ordinary' as const,
    executionPlan: {
      executablePath: '/fixed/bin/bash',
      args: ['--noprofile', '--norc', '-c', 'pnpm dev'],
      cwd: '/workspace',
      environment: { PATH: '/fixed/bin' },
    },
    adapterState: {},
  }
}
