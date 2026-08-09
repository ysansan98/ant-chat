import type { ExecFileException } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeCommandPath } from '../loginShellPath'

describe('mergeCommandPath', () => {
  it('按出现顺序合并并去重，忽略空段', () => {
    expect(mergeCommandPath('/a:/b', undefined, '/b:/c', '')).toBe('/a:/b:/c')
  })

  it('bundled CLI 目录保持在首位', () => {
    expect(mergeCommandPath('/res/ant-chat', '/usr/bin:/bin', '/usr/bin')).toBe('/res/ant-chat:/usr/bin:/bin')
  })

  it('全部为空时返回空字符串', () => {
    expect(mergeCommandPath()).toBe('')
    expect(mergeCommandPath(undefined, '', undefined)).toBe('')
  })
})

describe('resolveLoginShellPath', () => {
  afterEach(() => {
    // 模块级缓存一次解析结果，重置模块让每个用例独立
    vi.resetModules()
  })

  it('以交互 login shell 执行 printf 并返回 stdout 的 PATH', async () => {
    vi.resetModules()
    const { resolveLoginShellPath } = await import('../loginShellPath')
    const execFileFn = vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: null, stdout: string) => void) => {
      callback(null, '/Users/me/.nvm/versions/node/v24.12.0/bin:/usr/local/bin\n')
    })

    await expect(
      resolveLoginShellPath({ execFileFn: execFileFn as never, shellPath: '/bin/zsh' }),
    ).resolves.toBe('/Users/me/.nvm/versions/node/v24.12.0/bin:/usr/local/bin')
    expect(execFileFn).toHaveBeenCalledWith(
      '/bin/zsh',
      ['-li', '-c', 'printf %s "$PATH"'],
      expect.objectContaining({ timeout: 5_000, env: expect.objectContaining({ TERM: 'dumb' }) }),
      expect.any(Function),
    )
  })

  it('默认 shell 取 process.env.SHELL，缺失时回退 /bin/zsh', async () => {
    vi.resetModules()
    const { resolveLoginShellPath } = await import('../loginShellPath')
    const execFileFn = vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: null, stdout: string) => void) => {
      callback(null, '/bin:/usr/bin')
    })

    await resolveLoginShellPath({ execFileFn: execFileFn as never, environment: { SHELL: '/bin/bash' } })
    expect(execFileFn).toHaveBeenCalledWith('/bin/bash', expect.anything(), expect.anything(), expect.anything())

    vi.resetModules()
    const { resolveLoginShellPath: resolveAgain } = await import('../loginShellPath')
    const fallbackFn = vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: null, stdout: string) => void) => {
      callback(null, '/bin:/usr/bin')
    })
    await resolveAgain({ execFileFn: fallbackFn as never, environment: {} })
    expect(fallbackFn).toHaveBeenCalledWith('/bin/zsh', expect.anything(), expect.anything(), expect.anything())
  })

  it('执行失败时警告并返回 undefined', async () => {
    vi.resetModules()
    const { resolveLoginShellPath } = await import('../loginShellPath')
    const execFileFn = vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: ExecFileException, stdout: string) => void) => {
      callback({ message: 'spawn /bin/zsh ENOENT', name: 'Error' } as ExecFileException, '')
    })
    const warn = vi.fn()

    await expect(
      resolveLoginShellPath({ execFileFn: execFileFn as never, shellPath: '/bin/zsh', warn }),
    ).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledOnce()
  })

  it('stdout 为空时返回 undefined 且不警告', async () => {
    vi.resetModules()
    const { resolveLoginShellPath } = await import('../loginShellPath')
    const execFileFn = vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: null, stdout: string) => void) => {
      callback(null, '   ')
    })

    await expect(
      resolveLoginShellPath({ execFileFn: execFileFn as never, shellPath: '/bin/zsh' }),
    ).resolves.toBeUndefined()
  })

  it('进程生命周期内只解析一次（缓存）', async () => {
    vi.resetModules()
    const { resolveLoginShellPath } = await import('../loginShellPath')
    const execFileFn = vi.fn((_file: string, _args: string[], _options: unknown, callback: (error: null, stdout: string) => void) => {
      callback(null, '/opt/homebrew/bin:/usr/bin')
    })

    await resolveLoginShellPath({ execFileFn: execFileFn as never, shellPath: '/bin/zsh' })
    await resolveLoginShellPath({ execFileFn: execFileFn as never, shellPath: '/bin/zsh' })
    expect(execFileFn).toHaveBeenCalledOnce()
  })
})
