import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runControlCli } from './index'

const sharedMock = vi.hoisted(() => ({
  resolveAppDataRoot: vi.fn<(environment?: string) => string>(),
}))

vi.mock('@ant-chat/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ant-chat/shared')>()
  return { ...actual, resolveAppDataRoot: sharedMock.resolveAppDataRoot }
})

describe('runControlCli 控制 Socket 集成', () => {
  const roots: string[] = []
  const servers: ReturnType<typeof createServer>[] = []

  beforeEach(() => {
    sharedMock.resolveAppDataRoot.mockImplementation(environment => environment === 'development'
      ? '/tmp/ant-chat-dev-mock'
      : '/tmp/ant-chat-prod-mock')
  })

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
    sharedMock.resolveAppDataRoot.mockReset()
  })

  it('从 endpoint 元数据连接 Runtime 并格式化 JSON 结果', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ant-chat-control-client-'))
    roots.push(root)
    const endpoint = path.join(root, 'control.sock')
    const authToken = 'test-auth-token'
    const server = createServer((socket) => {
      let request = ''
      socket.on('data', (chunk) => {
        request += chunk.toString()
        if (!request.endsWith('\n'))
          return
        const parsed = JSON.parse(request) as { auth: string, command: unknown }
        expect(parsed.auth).toBe(authToken)
        expect(parsed.command).toEqual({ action: 'show', type: 'settings' })
        socket.end(`${JSON.stringify({ ok: true, result: { settings: { assistantModelId: 'model-1' } } })}\n`)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, resolve)
    })

    await writeFile(path.join(root, '.control-endpoint.json'), JSON.stringify({
      protocolVersion: 1,
      pid: process.pid,
      endpoint,
      authToken,
    }))

    const result = await runControlCli(['settings', 'show', '--json'], { appDataRoot: root })

    expect(result).toEqual({
      exitCode: 0,
      output: JSON.stringify({ settings: { assistantModelId: 'model-1' } }, null, 2),
    })
    expect(await readFile(path.join(root, '.control-endpoint.json'), 'utf8')).toContain(authToken)
  })

  it('端点 pid 已退出时报残留元数据提示而不是误指为运行中服务', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ant-chat-control-client-'))
    roots.push(root)
    await writeFile(path.join(root, '.control-endpoint.json'), JSON.stringify({
      protocolVersion: 1,
      // 必然不存在的 pid：process.kill(pid, 0) 会抛 ESRCH/EINVAL
      pid: 999_999_999,
      endpoint: path.join(root, 'missing.sock'),
      authToken: 'test-auth-token',
    }))

    const result = await runControlCli(['settings', 'show', '--json'], { appDataRoot: root })

    expect(result.exitCode).toBe(1)
    expect(result.error).toContain('已退出')
    expect(result.error).toContain('残留')
  })

  it('默认根为残留时回退到另一默认根上运行中的 Runtime', async () => {
    const prodRoot = await mkdtemp(path.join(tmpdir(), 'ant-chat-control-client-prod-'))
    const devRoot = await mkdtemp(path.join(tmpdir(), 'ant-chat-control-client-dev-'))
    roots.push(prodRoot, devRoot)
    sharedMock.resolveAppDataRoot.mockImplementation(environment => environment === 'development' ? devRoot : prodRoot)

    // 生产根：残留端点（死 pid）
    await writeFile(path.join(prodRoot, '.control-endpoint.json'), JSON.stringify({
      protocolVersion: 1,
      pid: 999_999_999,
      endpoint: path.join(prodRoot, 'dead.sock'),
      authToken: 'stale-token',
    }))

    // dev 根：真实运行中的控制服务
    const endpoint = path.join(devRoot, 'control.sock')
    const server = createServer((socket) => {
      let request = ''
      socket.on('data', (chunk) => {
        request += chunk.toString()
        if (!request.endsWith('\n'))
          return
        socket.end(`${JSON.stringify({ ok: true, result: { settings: { assistantModelId: 'fallback-model' } } })}\n`)
      })
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(endpoint, resolve)
    })
    await writeFile(path.join(devRoot, '.control-endpoint.json'), JSON.stringify({
      protocolVersion: 1,
      pid: process.pid,
      endpoint,
      authToken: 'dev-token',
    }))

    const result = await runControlCli(['settings', 'show', '--json'], { appDataRoot: prodRoot })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('fallback-model')
  })
})
