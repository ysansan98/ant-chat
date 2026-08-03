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

  it('同一数据目录拒绝第二个 Runtime', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'ant-chat-control-'))
    roots.push(root)
    const first = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
    const second = new LocalControlServer({ execute: vi.fn() }, { appDataRoot: root })
    servers.push(first)
    await first.start()

    await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' })
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
