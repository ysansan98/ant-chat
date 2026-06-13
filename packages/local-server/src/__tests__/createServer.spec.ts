import type { AddressInfo } from 'node:net'
import type { AppRuntime } from '@ant-chat/app-runtime'
import { request } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalServer } from '../createServer'

const runtime = {
  chat: {
    listConversations: vi.fn(),
  },
} as unknown as AppRuntime

let server: ReturnType<typeof createLocalServer>
let baseUrl: URL

beforeEach(async () => {
  vi.clearAllMocks()
  runtime.chat.listConversations = vi.fn().mockResolvedValue({ data: [], total: 0 })
  server = createLocalServer(runtime)
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address() as AddressInfo
  baseUrl = new URL(`http://127.0.0.1:${address.port}`)
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
        params: { pageIndex: 0, pageSize: 20 },
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
