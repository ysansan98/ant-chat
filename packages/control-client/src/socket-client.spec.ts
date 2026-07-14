import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runControlCli } from './index'

describe('runControlCli 控制 Socket 集成', () => {
  const roots: string[] = []
  const servers: ReturnType<typeof createServer>[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => server.close(() => resolve()))))
    await Promise.all(roots.splice(0).map(root => rm(root, { force: true, recursive: true })))
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
})
