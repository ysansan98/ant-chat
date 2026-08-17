import type { AppControlResult } from '@ant-chat/shared'
import { connect } from 'node:net'
import fs from 'node:fs'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LocalControlServer } from './localControlServer'

describe('localControlServer', () => {
  const roots: string[] = []
  const servers: LocalControlServer[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => server.stop()))
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
  })

  it('只接受元数据中的认证 token 并返回控制结果', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    const appControl = {
      execute: vi.fn(async (): Promise<AppControlResult> => ({
        settings: {
          appearance: { darkThemeId: 'default', lightThemeId: 'default', mode: 'system' },
          assistantModelId: 'model-1',
          assistantProviderId: 'provider-1',
          visionModelId: '',
          visionProviderId: '',
          defaultModelId: '',
          defaultProviderId: '',
          autoGenerateTitle: true,
          developerTools: { agentObservabilityEnabled: false },
          proxySettings: { mode: 'none' },
        },
      })),
    }
    const server = new LocalControlServer(appControl, { appDataRoot: root })
    servers.push(server)
    await server.start()

    const meta = JSON.parse(await readFile(path.join(root, '.control-endpoint.json'), 'utf8')) as {
      authToken: string
      endpoint: string
    }
    await expect(sendRequest(meta.endpoint, { auth: 'wrong', command: { action: 'show', type: 'settings' } }))
      .resolves
      .toMatchObject({ error: { code: 'AUTH_FAILED' }, ok: false })
    await expect(sendRequest(meta.endpoint, { auth: meta.authToken, command: { action: 'show', type: 'settings' } }))
      .resolves
      .toMatchObject({ ok: true, result: { settings: { assistantModelId: 'model-1' } } })
    expect(appControl.execute).toHaveBeenCalledOnce()

    if (process.platform !== 'win32') {
      expect((await stat(meta.endpoint)).mode & 0o777).toBe(0o600)
      expect((await stat(path.join(root, '.control-endpoint.json'))).mode & 0o777).toBe(0o600)
    }
  })

  it('停止后删除端点元数据', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    const server = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
    await server.start()

    await server.stop()

    expect(fs.existsSync(path.join(root, '.control-endpoint.json'))).toBe(false)
  })

  it('在调用控制层前拒绝不完整的 socket 命令', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    const appControl = { execute: vi.fn() }
    const server = new LocalControlServer(appControl, { appDataRoot: root })
    servers.push(server)
    await server.start()

    const meta = JSON.parse(await readFile(path.join(root, '.control-endpoint.json'), 'utf8')) as {
      authToken: string
      endpoint: string
    }
    await expect(sendRequest(meta.endpoint, {
      auth: meta.authToken,
      command: { action: 'install', serverName: 'demo', transportType: 'stdio', type: 'mcp' },
    })).resolves.toMatchObject({ error: { code: 'INVALID_COMMAND' }, ok: false })

    expect(appControl.execute).not.toHaveBeenCalled()
  })

  it('拒绝同时携带 path 与 fileId 的 image recognize 命令（互斥校验）', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    const appControl = { execute: vi.fn() }
    const server = new LocalControlServer(appControl, { appDataRoot: root })
    servers.push(server)
    await server.start()

    const meta = JSON.parse(await readFile(path.join(root, '.control-endpoint.json'), 'utf8')) as {
      authToken: string
      endpoint: string
    }
    await expect(sendRequest(meta.endpoint, {
      auth: meta.authToken,
      command: { type: 'image', action: 'recognize', path: '/tmp/a.png', fileId: 'img-1' },
    })).resolves.toMatchObject({ error: { code: 'INVALID_COMMAND' }, ok: false })

    expect(appControl.execute).not.toHaveBeenCalled()
  })

  it('同一数据目录拒绝第二个 Runtime', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    const first = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
    const second = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
    servers.push(first)
    await first.start()

    await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })

  it('锁文件指向已退出的 PID 时视为陈旧锁并接管', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    // 模拟崩溃遗留：PID 不存在（kill 探测返回 ESRCH）
    fs.writeFileSync(path.join(root, '.runtime.lock'), JSON.stringify({ pid: 2 ** 30, startedAt: 1 }), 'utf8')

    const server = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
    servers.push(server)
    await expect(server.start()).resolves.toBeUndefined()

    // 接管后锁文件写入本进程的 pid
    const lock = JSON.parse(fs.readFileSync(path.join(root, '.runtime.lock'), 'utf8')) as { pid: number }
    expect(lock.pid).toBe(process.pid)
  })

  it('锁记录 PID 被其他进程复用（存活但非 ant-chat）时视为陈旧锁并接管', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    // startedAt 与宿主进程的真实启动时刻不匹配 → PID 已被系统复用
    fs.writeFileSync(path.join(root, '.runtime.lock'), JSON.stringify({ pid: process.ppid, startedAt: 1 }), 'utf8')
    fs.writeFileSync(
      path.join(root, '.control-endpoint.json'),
      JSON.stringify({ protocolVersion: 1, pid: process.ppid, startedAt: 1, endpoint: 'stale', authToken: 'stale' }),
      'utf8',
    )

    const server = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
    servers.push(server)
    await expect(server.start()).resolves.toBeUndefined()
  })

  it('无法探测的存活 PID（EPERM，如受保护系统进程）身份不匹配时同样视为陈旧', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    fs.writeFileSync(path.join(root, '.runtime.lock'), JSON.stringify({ pid: process.ppid, startedAt: 1 }), 'utf8')
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const error = new Error('EPERM') as NodeJS.ErrnoException
      error.code = 'EPERM'
      throw error
    })
    try {
      const server = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
      servers.push(server)
      await expect(server.start()).resolves.toBeUndefined()
    }
    finally {
      killSpy.mockRestore()
    }
  })

  it('旧版锁文件缺少 startedAt 时保持保守拒绝', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    // 旧版本写入的锁只有 pid，无法校验身份 → 视为存活，避免同一数据目录出现两个 Runtime
    fs.writeFileSync(path.join(root, '.runtime.lock'), JSON.stringify({ pid: process.ppid }), 'utf8')

    const server = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
    servers.push(server)
    await expect(server.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
  })

  it('不同数据目录的实例可同时监听（Windows 管道名按数据根隔离）', async () => {
    if (process.platform !== 'win32')
      return // POSIX 下 socket 文件本就位于各自数据根内，无需额外验证
    const rootA = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-a-'))
    const rootB = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-b-'))
    roots.push(rootA, rootB)
    const first = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: rootA })
    const second = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: rootB })
    servers.push(first, second)

    await expect(first.start()).resolves.toBeUndefined()
    await expect(second.start()).resolves.toBeUndefined()
  })
})

function sendRequest(endpoint: string, request: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = connect(endpoint)
    let response = ''
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => response += chunk.toString())
    socket.on('end', () => resolve(JSON.parse(response.trim())))
    socket.on('error', reject)
  })
}
