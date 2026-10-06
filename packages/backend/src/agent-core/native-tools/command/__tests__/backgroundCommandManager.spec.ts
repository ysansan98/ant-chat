import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import type { AgentCommandPaths } from '../../../../agentCommands'
import type { PreparedCommandState } from '../types'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BackgroundCommandManager, fingerprintCommand } from '../backgroundCommandManager'

let root: string
let paths: AgentCommandPaths

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-cmd-'))
  paths = {
    root,
    logsPath: path.join(root, 'logs'),
    statePath: path.join(root, 'state'),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  // 日志写入是异步流，句柄/文件可能在清理瞬间仍在创建；重试避免 ENOTEMPTY 竞态
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

function createPrepared(overrides: Partial<PreparedCommandState> = {}): PreparedCommandState {
  return {
    kind: 'command',
    interpreter: 'bash',
    input: { command: 'pnpm dev' },
    command: 'pnpm dev',
    cwd: '/workspace',
    segments: [],
    resourceScope: 'workspace',
    isReadOnly: false,
    hasSecretEnv: false,
    risk: 'ordinary',
    executionPlan: {
      executablePath: '/fixed/bin/bash',
      args: ['--noprofile', '--norc', '-c', 'pnpm dev'],
      cwd: '/workspace',
      environment: { PATH: '/fixed/bin', HOME: '/home/user' },
    },
    adapterState: {},
    ...overrides,
  }
}

function createChild(pid = 4242): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  child.stdout = new PassThrough() as ChildProcessWithoutNullStreams['stdout']
  child.stderr = new PassThrough() as ChildProcessWithoutNullStreams['stderr']
  child.kill = vi.fn(() => true)
  Object.assign(child, { pid })
  return child
}

async function waitFor(assert: () => boolean | Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await assert())
      return
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error('waitFor 超时')
}

async function readFileText(filePath: string): Promise<string> {
  try {
    return await fs.promises.readFile(filePath, 'utf8')
  }
  catch {
    return ''
  }
}

describe('后台命令管理器', () => {
  it('启动即返回 commandId，写入日志头部与状态文件', async () => {
    const child = createChild()
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child })

    const result = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })

    expect(result.ok).toBe(true)
    if (!result.ok)
      return
    expect(result.summary.commandId).toMatch(/^cmd-/)
    expect(result.summary.status).toBe('running')
    expect(result.summary.pid).toBe(4242)

    await waitFor(async () => (await readFileText(result.summary.logPath)).includes('# command: pnpm dev'))
    await waitFor(() => fs.existsSync(path.join(paths.statePath, `${result.summary.commandId}.json`)))
  })

  it('stdout/stderr 追加到同一日志，read 支持增量 offset/nextOffset', async () => {
    const child = createChild()
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok) {
      throw new Error('启动失败')
    }
    ;(child.stdout as PassThrough).write('first line\n')
    await waitFor(async () => (await readFileText(started.summary.logPath)).includes('first line'))

    const first = await manager.read('conv-1', started.summary.commandId, {})
    expect(first.text).toContain('first line')

    ;(child.stderr as PassThrough).write('second line\n')
    await waitFor(async () => (await readFileText(started.summary.logPath)).includes('second line'))

    const second = await manager.read('conv-1', started.summary.commandId, { offset: first.nextOffset })
    expect(second.offset).toBe(first.nextOffset)
    expect(second.text).toContain('second line')
    expect(second.text).not.toContain('first line')
  })

  it('waitMs 等待新输出，进程退出后读尾部', async () => {
    const child = createChild()
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')
    const commandId = started.summary.commandId

    await waitFor(async () => (await readFileText(started.summary.logPath)).includes('# command:'))
    const offset = (await manager.read('conv-1', commandId, {})).nextOffset

    const pending = manager.read('conv-1', commandId, { offset, waitMs: 1000 })
    setTimeout(() => {
      ;(child.stdout as PassThrough).write('new output\n')
    }, 30)
    const waited = await pending
    expect(waited.text).toContain('new output')

    child.emit('exit', 0)
    await waitFor(() => manager.list('conv-1')[0]?.status === 'exited')
    const summary = manager.list('conv-1')[0]
    expect(summary.exitCode).toBe(0)
    const tail = await manager.read('conv-1', commandId, { tail: 4096 })
    expect(tail.status).toBe('exited')
    expect(tail.text).toContain('new output')
  })

  it('日志达到上限后标记 truncated 并停止增长', async () => {
    const child = createChild()
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child, maxLogBytes: 512 })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok) {
      throw new Error('启动失败')
    }
    ;(child.stdout as PassThrough).write('x'.repeat(2048))
    await waitFor(() => manager.list('conv-1')[0]?.truncated === true)

    const result = await manager.read('conv-1', started.summary.commandId, { maxChars: 262_144 })
    expect(result.truncated).toBe(true)
  })

  it('kill 向进程组发 SIGTERM，宽限后补 SIGKILL', async () => {
    const child = createChild(5151)
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child, killGraceMs: 20 })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')

    void manager.kill('conv-1', started.summary.commandId)
    expect(killSpy).toHaveBeenCalledWith(-5151, 'SIGTERM')

    await waitFor(() => killSpy.mock.calls.some(call => call[1] === 'SIGKILL'), 2000)
  })

  it('启动与退出时推送会话全量快照', async () => {
    const child = createChild()
    const onChanged = vi.fn()
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child, onChanged })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')

    expect(onChanged).toHaveBeenCalledWith('conv-1', [
      expect.objectContaining({ commandId: started.summary.commandId, status: 'running' }),
    ])

    child.emit('exit', 0)
    await waitFor(() => onChanged.mock.calls.at(-1)?.[1]?.[0]?.status === 'exited')
  })

  it('超过并发上限直接拒绝', async () => {
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => createChild(), killGraceMs: 5 })
    for (let index = 0; index < 8; index++) {
      const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => createChild(1000 + index) })
      expect(started.ok).toBe(true)
    }
    const rejected = manager.start('conv-1', createPrepared(), { spawnProcess: () => createChild(9999) })
    expect(rejected).toMatchObject({ ok: false })
    await manager.dispose()
  })

  it('跨会话读取与终止被拒绝', async () => {
    const child = createChild()
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')

    await expect(manager.read('conv-2', started.summary.commandId, {})).rejects.toThrow()
    expect(await manager.kill('conv-2', started.summary.commandId)).toBeNull()
    expect(manager.list('conv-2')).toEqual([])
  })

  it('closeConversation 与 dispose 回收该会话记录', async () => {
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => createChild(), killGraceMs: 5 })
    const first = manager.start('conv-1', createPrepared(), { spawnProcess: () => createChild(6001) })
    const second = manager.start('conv-2', createPrepared(), { spawnProcess: () => createChild(6002) })
    if (!first.ok || !second.ok)
      throw new Error('启动失败')

    await manager.closeConversation('conv-1')
    expect(manager.list('conv-1')).toEqual([])
    expect(manager.list('conv-2')).toHaveLength(1)

    await manager.dispose()
    expect(manager.list('conv-2')).toEqual([])
  })
})

describe('后台命令孤儿扫描', () => {
  function writeStateFile(commandId: string, state: Record<string, unknown>): string {
    fs.mkdirSync(paths.statePath, { recursive: true })
    const target = path.join(paths.statePath, `${commandId}.json`)
    fs.writeFileSync(target, JSON.stringify(state))
    return target
  }

  it('校验通过则终止残留进程组并清理状态文件', async () => {
    const command = 'pnpm dev'
    const statePath = writeStateFile('cmd-1', {
      commandId: 'cmd-1',
      pid: process.pid,
      pgid: 777_001,
      startedAt: Date.now(),
      commandFingerprint: fingerprintCommand(command, '/workspace'),
      command,
      cwd: '/workspace',
    })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const manager = new BackgroundCommandManager(paths, {
      probeProcess: async () => ({ commandLine: `/bin/bash --noprofile --norc -c ${command}` }),
    })

    await manager.initialize()

    expect(killSpy).toHaveBeenCalledWith(-777_001, 'SIGTERM')
    expect(fs.existsSync(statePath)).toBe(false)
  })

  it('pid 复用或指纹不符时只清理记录，不 kill', async () => {
    const command = 'pnpm dev'
    const statePath = writeStateFile('cmd-2', {
      commandId: 'cmd-2',
      pid: process.pid,
      pgid: 777_002,
      startedAt: Date.now(),
      commandFingerprint: fingerprintCommand(command, '/workspace'),
      command,
      cwd: '/workspace',
    })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const manager = new BackgroundCommandManager(paths, {
      probeProcess: async () => ({ commandLine: '/usr/bin/some-other-process' }),
    })

    await manager.initialize()

    expect(killSpy).not.toHaveBeenCalledWith(-777_002, expect.anything())
    expect(fs.existsSync(statePath)).toBe(false)
  })
})

describe('后台命令结束通知', () => {
  it('自然退出入队，take 消费即清', async () => {
    const child = createChild()
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')

    child.emit('exit', 0)
    await waitFor(() => manager.peekNotices('conv-1').length === 1)

    expect(manager.peekNotices('conv-1')[0]).toMatchObject({
      commandId: started.summary.commandId,
      reason: 'exited',
      status: 'exited',
      exitCode: 0,
    })
    expect(manager.takeNotices('conv-1')).toHaveLength(1)
    expect(manager.takeNotices('conv-1')).toEqual([])
  })

  it('agent 自己 kill 不回队，用户 kill 回队', async () => {
    const agentChild = createChild(9001)
    const userChild = createChild(9002)
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => agentChild, killGraceMs: 5 })
    const agentStarted = manager.start('conv-1', createPrepared(), { spawnProcess: () => agentChild })
    const userStarted = manager.start('conv-1', createPrepared(), { spawnProcess: () => userChild })
    if (!agentStarted.ok || !userStarted.ok)
      throw new Error('启动失败')

    const agentKill = manager.kill('conv-1', agentStarted.summary.commandId, 'SIGTERM', 'agent')
    agentChild.emit('exit', null)
    await agentKill

    const userKill = manager.kill('conv-1', userStarted.summary.commandId, 'SIGTERM', 'user')
    userChild.emit('exit', null)
    await userKill

    await waitFor(() => manager.peekNotices('conv-1').length === 1)
    const notices = manager.peekNotices('conv-1')
    expect(notices).toHaveLength(1)
    expect(notices[0]).toMatchObject({
      commandId: userStarted.summary.commandId,
      reason: 'user_killed',
      status: 'killed',
    })
  })

  it('看门狗终止入队为 watchdog', async () => {
    const child = createChild(9101)
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child })
    manager.start('conv-1', createPrepared(), { spawnProcess: () => child, watchdogMs: 10 })

    await new Promise(resolve => setTimeout(resolve, 30))
    child.emit('exit', null)
    await waitFor(() => manager.peekNotices('conv-1').length === 1)
    expect(manager.peekNotices('conv-1')[0]?.reason).toBe('watchdog')
  })

  it('会话关闭不产生通知并清空队列', async () => {
    const child = createChild(9201)
    vi.spyOn(process, 'kill').mockImplementation(() => true)
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child, killGraceMs: 5 })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')

    const closing = manager.closeConversation('conv-1')
    child.emit('exit', null)
    await closing

    expect(manager.peekNotices('conv-1')).toEqual([])
  })

  it('agent 读到终态即消费通知，UI 日志预览不影响队列', async () => {
    const child = createChild()
    const manager = new BackgroundCommandManager(paths, { spawnProcess: () => child })
    const started = manager.start('conv-1', createPrepared(), { spawnProcess: () => child })
    if (!started.ok)
      throw new Error('启动失败')

    child.emit('exit', 0)
    await waitFor(() => manager.peekNotices('conv-1').length === 1)

    // UI 尾部预览：不消费通知
    await manager.read('conv-1', started.summary.commandId, { tail: 1024 })
    expect(manager.peekNotices('conv-1')).toHaveLength(1)

    // agent 工具读取：读到终态后消费通知
    const result = await manager.read('conv-1', started.summary.commandId, { consumeNotices: true })
    expect(result.status).toBe('exited')
    expect(manager.peekNotices('conv-1')).toEqual([])
  })
})
