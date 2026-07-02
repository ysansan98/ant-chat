import type { AddressInfo } from 'node:net'
import type { AppRuntime } from '@ant-chat/backend'
import { request } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalServer } from '../createServer'
import type { RpcLimits } from '../createServer'

const runtime = {
  chat: {
    listConversations: vi.fn(),
  },
  settings: {
    get: vi.fn(),
  },
} as unknown as AppRuntime

let server: ReturnType<typeof createLocalServer>
let baseUrl: URL

async function startServer(limits?: RpcLimits) {
  vi.clearAllMocks()
  runtime.chat.listConversations = vi.fn().mockResolvedValue({ data: [], total: 0 })
  runtime.settings.get = vi.fn().mockResolvedValue({
    assistantModelId: 'model-1',
    proxySettings: { mode: 'none' },
  })
  server = createLocalServer(runtime, limits)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  baseUrl = new URL(`http://127.0.0.1:${address.port}`)
}

beforeEach(async () => {
  await startServer()
})

afterEach(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error)
        reject(error)
      else
        resolve()
    })
  })
})

describe('createLocalServer', () => {
  it('处理 API 的 OPTIONS 请求', async () => {
    const response = await send({
      method: 'OPTIONS',
      path: '/api/rpc',
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(response.body).toBe('')
  })

  it('返回同源 RPC 响应', async () => {
    const response = await send({
      method: 'POST',
      path: '/api/rpc',
      body: JSON.stringify({
        method: 'chat.getConversations',
        input: { pageIndex: 0, pageSize: 20 },
      }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      data: { data: [], total: 0 },
    })
    expect(runtime.chat.listConversations).toHaveBeenCalledWith(0, 20)
  })

  it('通过统一 handler 调用非 chat runtime 能力', async () => {
    const response = await send({
      method: 'POST',
      path: '/api/rpc',
      body: JSON.stringify({
        method: 'settings.getSettings',
      }),
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      data: {
        assistantModelId: 'model-1',
        proxySettings: { mode: 'none' },
      },
    })
    expect(runtime.settings.get).toHaveBeenCalled()
  })

  it('未知 RPC 方法返回错误响应', async () => {
    const response = await send({
      method: 'POST',
      path: '/api/rpc',
      body: JSON.stringify({
        method: 'missing.method',
      }),
    })

    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body)).toEqual({
      success: false,
      msg: 'Unknown local RPC method: missing.method',
    })
  })

  it('接受恰好等于上限的请求体', async () => {
    await startServer({ maxBodyBytes: 100 })
    const body = JSON.stringify({ method: 'chat.getConversations', input: { pageIndex: 0, pageSize: 20 } })
    const response = await send({
      method: 'POST',
      path: '/api/rpc',
      body,
    })

    expect(response.statusCode).toBe(200)
    expect(JSON.parse(response.body).success).toBe(true)
  })

  it('超过大小限制返回 413', async () => {
    await startServer({ maxBodyBytes: 10 })
    const body = JSON.stringify({ method: 'chat.getConversations', input: { pageIndex: 0, pageSize: 20 } })
    const response = await send({
      method: 'POST',
      path: '/api/rpc',
      body,
    })

    expect(response.statusCode).toBe(413)
    expect(JSON.parse(response.body).success).toBe(false)
    expect(runtime.chat.listConversations).not.toHaveBeenCalled()
  })

  it('分多个 chunk 超限也返回 413', async () => {
    await startServer({ maxBodyBytes: 10 })
    const response = await sendChunked({
      method: 'POST',
      path: '/api/rpc',
      chunks: ['{"method":', '"chat.getConversations","params":{}', '}'],
    })

    expect(response.statusCode).toBe(413)
    expect(JSON.parse(response.body).success).toBe(false)
  })

  it('超时请求返回 408', async () => {
    await startServer({ bodyTimeoutMs: 100 })
    const response = await sendSlow({
      method: 'POST',
      path: '/api/rpc',
      body: '{"method":"chat.getConversations","params":{}}',
      delayMs: 200,
    })

    expect(response.statusCode).toBe(408)
    expect(JSON.parse(response.body).success).toBe(false)
  })

  it('非 JSON 请求返回 500', async () => {
    const response = await send({
      method: 'POST',
      path: '/api/rpc',
      body: 'not json',
    })

    expect(response.statusCode).toBe(500)
    expect(JSON.parse(response.body).success).toBe(false)
  })
})

function send(options: { method: string, path: string, body?: string }): Promise<{ statusCode: number, headers: Record<string, string | string[] | undefined>, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(options.path, baseUrl),
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
          headers: res.headers,
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

function sendChunked(options: { method: string, path: string, chunks: string[] }): Promise<{ statusCode: number, headers: Record<string, string | string[] | undefined>, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(options.path, baseUrl),
      {
        method: options.method,
        headers: { 'content-type': 'application/json' },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => body += chunk)
        res.on('end', () => resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body,
        }))
      },
    )
    req.on('error', reject)
    for (const chunk of options.chunks) {
      req.write(chunk)
    }
    req.end()
  })
}

function sendSlow(options: { method: string, path: string, body: string, delayMs: number }): Promise<{ statusCode: number, headers: Record<string, string | string[] | undefined>, body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      new URL(options.path, baseUrl),
      {
        method: options.method,
        headers: { 'content-type': 'application/json' },
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', chunk => body += chunk)
        res.on('end', () => resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body,
        }))
      },
    )
    req.on('error', reject)
    req.write(options.body.slice(0, 1))
    setTimeout(() => {
      req.write(options.body.slice(1))
      req.end()
    }, options.delayMs)
  })
}
