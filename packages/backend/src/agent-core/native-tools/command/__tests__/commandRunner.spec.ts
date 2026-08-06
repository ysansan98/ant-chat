import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { PreparedCommandState } from '../types'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPreparedCommand } from '../commandRunner'

function createPrepared(overrides: Partial<PreparedCommandState> = {}): PreparedCommandState {
  return {
    kind: 'command',
    interpreter: 'bash',
    input: { command: 'printf ok' },
    command: 'printf ok',
    cwd: '/workspace',
    segments: [],
    resourceScope: 'workspace',
    isReadOnly: true,
    hasSecretEnv: false,
    risk: 'ordinary',
    executionPlan: {
      executablePath: '/fixed/bin/bash',
      args: ['--noprofile', '--norc', '-c', 'printf ok'],
      cwd: '/workspace',
      environment: { PATH: '/fixed/bin' },
    },
    adapterState: {},
    ...overrides,
  }
}

function createChild(overrides: Partial<ChildProcessWithoutNullStreams> = {}) {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  child.stdout = new PassThrough() as ChildProcessWithoutNullStreams['stdout']
  child.stderr = new PassThrough() as ChildProcessWithoutNullStreams['stderr']
  child.kill = vi.fn(() => true)
  return Object.assign(child, overrides)
}

function createSpawnProcess(child: ChildProcessWithoutNullStreams) {
  return vi.fn((
    _executable: string,
    _args: readonly string[],
    _options: SpawnOptionsWithoutStdio,
  ) => child)
}

describe('命令执行边界', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('只执行 prepared plan 中固定的解释器、参数、目录和受控环境', async () => {
    const child = createChild()
    const spawnProcess = vi.fn((
      _executable: string,
      _args: readonly string[],
      _options: SpawnOptionsWithoutStdio,
    ) => child)
    const resultPromise = runPreparedCommand(createPrepared(), false, {
      secretEnv: { TOKEN: 'secret' },
      spawnProcess,
    })

    ;(child.stdout as PassThrough).write('ok')
    ;(child.stdout as PassThrough).end()
    child.emit('close', 0)

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      diagnostics: { stdout: 'ok', exitCode: 0 },
    })
    expect(spawnProcess).toHaveBeenCalledWith(
      '/fixed/bin/bash',
      ['--noprofile', '--norc', '-c', 'printf ok'],
      {
        cwd: '/workspace',
        detached: process.platform !== 'win32',
        shell: false,
        windowsHide: true,
        env: { PATH: '/fixed/bin', TOKEN: 'secret' },
      },
    )
  })

  it('取消信号立即返回取消结果并向整个进程组发 SIGTERM', async () => {
    const child = createChild({ pid: 4242 })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)
    const controller = new AbortController()
    const resultPromise = runPreparedCommand(createPrepared(), false, {
      spawnProcess: createSpawnProcess(child),
      abortSignal: controller.signal,
    })

    controller.abort()

    // 子进程永不 close/exit，Promise 也必须立即 settle，不依赖进程自然退出
    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      result: '任务已取消。',
    })
    expect(killSpy).toHaveBeenCalledWith(-4242, 'SIGTERM')
  })

  it('信号已中止时不启动子进程', async () => {
    const controller = new AbortController()
    controller.abort()
    const spawnProcess = vi.fn()

    const result = await runPreparedCommand(createPrepared(), false, {
      spawnProcess,
      abortSignal: controller.signal,
    })

    expect(result).toMatchObject({
      ok: false,
      result: expect.stringContaining('任务已取消。'),
    })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('超时立即收尾并终止整个进程组，不等待 close', async () => {
    const child = createChild({ pid: 4321 })
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

    const resultPromise = runPreparedCommand(createPrepared({
      input: { command: 'sleep', timeoutMs: 20 },
    }), false, { spawnProcess: createSpawnProcess(child) })

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      result: '命令执行超时。',
    })
    expect(killSpy).toHaveBeenCalledWith(-4321, 'SIGTERM')
  })

  it('不再静默 cap timeoutMs，按模型请求时长生效', async () => {
    vi.useFakeTimers()
    const child = createChild()
    vi.spyOn(process, 'kill').mockImplementation(() => true)

    const resultPromise = runPreparedCommand(createPrepared({
      input: { command: 'sleep', timeoutMs: 600_000 },
    }), false, { spawnProcess: createSpawnProcess(child) })

    vi.advanceTimersByTime(600_000)

    await expect(resultPromise).resolves.toMatchObject({
      ok: false,
      result: '命令执行超时。',
    })
  })

  it('exit 后孙进程持有管道时仍会收尾，不依赖 close', async () => {
    const child = createChild()
    const resultPromise = runPreparedCommand(createPrepared(), false, {
      spawnProcess: createSpawnProcess(child),
    })

    child.emit('exit', 0)
    // 故意不触发 close：模拟孙进程继承 stdio 管道导致 close 永不发生

    await expect(resultPromise).resolves.toMatchObject({
      ok: true,
      diagnostics: { exitCode: 0 },
    })
  })

  it('底线阻断不会触达子进程边界', async () => {
    const spawnProcess = vi.fn()

    const result = await runPreparedCommand(createPrepared({
      risk: 'bottomline_block',
      riskReason: '禁止删除系统根目录',
    }), true, { spawnProcess })

    expect(result).toMatchObject({
      ok: false,
      result: expect.stringContaining('禁止删除系统根目录'),
    })
    expect(spawnProcess).not.toHaveBeenCalled()
  })
})
