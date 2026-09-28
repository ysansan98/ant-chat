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

  it('image generate 解析为命令并透传目录、尺寸与超时；JSON 输出返回产物路径', async () => {
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
        expect(parsed.command).toEqual({
          type: 'image',
          action: 'generate',
          prompt: '一只金色小猫',
          width: 1024,
          height: 1024,
          // CLI 在发送前把产物目录解析为绝对路径（后端进程 cwd 与 CLI 不同）。
          outputDir: path.resolve('./out'),
          timeoutMs: 60_000,
        })
        socket.end(`${JSON.stringify({
          ok: true,
          result: {
            providerId: 'modelscope',
            modelId: 'Qwen/Qwen-Image',
            files: [{ path: '/abs/generated/a.png', mediaType: 'image/png', bytes: 2048 }],
            taskId: 'task-1',
            elapsedMs: 12_345,
          },
        })}\n`)
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

    const result = await runControlCli([
      'image',
      'generate',
      '--prompt',
      '一只金色小猫',
      '--width',
      '1024',
      '--height',
      '1024',
      '--output',
      './out',
      '--timeout',
      '60000',
      '--json',
    ], { appDataRoot: root })

    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.output!)).toMatchObject({
      taskId: 'task-1',
      files: [{ path: '/abs/generated/a.png', mediaType: 'image/png', bytes: 2048 }],
      elapsedMs: 12_345,
    })
  })

  it('image generate 缺省产物目录为 ./generated，人类可读输出列出生图结果', async () => {
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
        const parsed = JSON.parse(request) as { command: { outputDir?: string } }
        expect(parsed.command.outputDir).toBe(path.resolve('./generated'))
        socket.end(`${JSON.stringify({
          ok: true,
          result: {
            providerId: 'modelscope',
            modelId: 'Qwen/Qwen-Image',
            files: [{ path: '/abs/generated/a.png', mediaType: 'image/png', bytes: 2048 }],
            taskId: 'task-1',
            elapsedMs: 12_345,
          },
        })}\n`)
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

    const result = await runControlCli(['image', 'generate', '--prompt', 'cat'], { appDataRoot: root })

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('生成模型：modelscope/Qwen/Qwen-Image')
    expect(result.output).toContain('任务：task-1')
    expect(result.output).toContain('文件：/abs/generated/a.png（2KB）')
    expect(result.output).toContain('耗时：12.3s')
  })

  it('--timeout 到点后 CLI 报等待响应超时', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ant-chat-control-client-'))
    roots.push(root)
    const endpoint = path.join(root, 'control.sock')
    const authToken = 'test-auth-token'
    const server = createServer((socket) => {
      // 故意延迟响应，模拟生图阻塞等待超过调用方给的超时。
      socket.on('data', () => {
        setTimeout(() => socket.end(`${JSON.stringify({ ok: true, result: {} })}\n`), 300)
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

    const result = await runControlCli(['image', 'recognize', '--file-id', 'img-1', '--timeout', '50'], { appDataRoot: root })

    expect(result.exitCode).toBe(1)
    expect(result.error).toContain('等待响应超时')
  })

  it('未传 --timeout 时不设响应超时（慢响应仍可成功返回）', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ant-chat-control-client-'))
    roots.push(root)
    const endpoint = path.join(root, 'control.sock')
    const authToken = 'test-auth-token'
    const server = createServer((socket) => {
      socket.on('data', () => {
        setTimeout(() => socket.end(`${JSON.stringify({ ok: true, result: { settings: { assistantModelId: 'slow-model' } } })}\n`), 150)
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

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('slow-model')
  })
})
