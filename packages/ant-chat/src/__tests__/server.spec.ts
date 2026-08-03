import type { AppRuntime, AppRuntimeEventName } from '@ant-chat/backend'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { listen } from '../serverHost'

const eventEmitter = new EventEmitter()
const invoke = vi.fn()
const runtime = {
  invoke,
  dispose: vi.fn(),
  events: {
    on(name: AppRuntimeEventName, listener: (event: unknown) => void) {
      eventEmitter.on(name, listener)
      return () => eventEmitter.off(name, listener)
    },
  },
} as unknown as AppRuntime

let webRoot: string
let server: Awaited<ReturnType<typeof listen>>
let baseUrl: URL

beforeEach(async () => {
  vi.clearAllMocks()
  eventEmitter.removeAllListeners()
  webRoot = mkdtempSync(path.join(tmpdir(), 'ant-chat-product-'))
  writeFileSync(path.join(webRoot, 'index.html'), '<html>Ant Chat</html>')
  writeFileSync(path.join(webRoot, 'app.js'), 'console.log("Ant Chat")')
  invoke.mockResolvedValue({ data: [], total: 0 })
  server = await listen(runtime, {
    host: '127.0.0.1',
    port: 0,
    webRoot,
  })
  baseUrl = new URL(`http://127.0.0.1:${server.port}`)
})

afterEach(async () => {
  await server.close()
  rmSync(webRoot, { force: true, recursive: true })
})

describe('listen', () => {
  it('提供 Web 入口、静态资源和 SPA 路由', async () => {
    const home = await send('/')
    const asset = await send('/app.js')
    const route = await send('/settings')

    expect(home).toMatchObject({
      statusCode: 200,
      body: '<html>Ant Chat</html>',
      contentType: 'text/html; charset=utf-8',
    })
    expect(asset).toMatchObject({
      statusCode: 200,
      body: 'console.log("Ant Chat")',
      contentType: 'text/javascript; charset=utf-8',
    })
    expect(route).toMatchObject({
      statusCode: 200,
      body: '<html>Ant Chat</html>',
    })
  })

  it('缺失静态资源返回 404', async () => {
    const response = await send('/missing.js')

    expect(response.statusCode).toBe(404)
    expect(JSON.parse(response.body)).toEqual({
      success: false,
      msg: 'Unknown route: /missing.js',
    })
  })

  it('优先处理 RPC 请求', async () => {
    const response = await send('/api/rpc', {
      method: 'POST',
      body: JSON.stringify({
        method: 'chat.getConversations',
        input: { pageIndex: 0, pageSize: 20 },
      }),
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      data: { data: [], total: 0 },
    })
  })

  it('通过 SSE 推送运行时事件', async () => {
    const payload = await readSseEvent('workspace:changed', () => {
      eventEmitter.emit('workspace:changed', {})
    })

    expect(payload).toContain('event: workspace:changed')
    expect(payload).toContain('data: {}')
  })

  it('通过 SSE 推送敏感信息请求事件', async () => {
    const payload = await readSseEvent('agent:secret-requested', () => {
      eventEmitter.emit('agent:secret-requested', {
        request: {
          requestId: 'request-1',
          runId: 'run-1',
          conversationId: 'conversation-1',
          label: '需要 API Key',
          fields: [],
          createdAt: 1,
        },
      })
    })

    expect(payload).toContain('event: agent:secret-requested')
    expect(payload).toContain('"requestId":"request-1"')
  })

  it('重复关闭时只释放一次 Runtime', async () => {
    await server.close()
    await server.close()

    expect(runtime.dispose).toHaveBeenCalledTimes(1)
  })
})

function send(
  pathname: string,
  options: { method?: string, body?: string } = {},
): Promise<{ statusCode: number, contentType: string | undefined, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(pathname, baseUrl),
      {
        method: options.method,
        headers: options.body ? { 'content-type': 'application/json' } : undefined,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => body += chunk)
        res.on('end', () => resolve({
          statusCode: res.statusCode ?? 0,
          contentType: res.headers['content-type'],
          body,
        }))
      },
    )
    req.on('error', reject)
    if (options.body)
      req.write(options.body)
    req.end()
  })
}

function readSseEvent(eventName: string, emit: () => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request(new URL('/api/events', baseUrl), (res) => {
      let body = ''
      let emitted = false
      res.setEncoding('utf8')
      res.on('data', (chunk) => {
        body += chunk
        if (!emitted && body.includes(': connected\n\n')) {
          emitted = true
          emit()
        }
        if (!body.includes(`event: ${eventName}`))
          return
        req.destroy()
        resolve(body)
      })
      res.on('error', reject)
    })
    req.on('error', error => error.message === 'socket hang up' ? undefined : reject(error))
    req.end()
  })
}
