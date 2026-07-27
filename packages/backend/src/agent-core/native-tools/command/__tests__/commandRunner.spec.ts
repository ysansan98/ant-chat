import type { ChildProcessWithoutNullStreams, SpawnOptionsWithoutStdio } from 'node:child_process'
import type { PreparedCommandState } from '../types'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
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

function createChild() {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams
  child.stdout = new PassThrough() as ChildProcessWithoutNullStreams['stdout']
  child.stderr = new PassThrough() as ChildProcessWithoutNullStreams['stderr']
  child.kill = vi.fn(() => true)
  return child
}

describe('命令执行边界', () => {
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
        shell: false,
        windowsHide: true,
        env: { PATH: '/fixed/bin', TOKEN: 'secret' },
      },
    )
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
