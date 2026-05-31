import type { AddressInfo } from 'node:net'
import type { LocalServerServices } from '../createServer'
import { request } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLocalServer } from '../createServer'

const services = {
  conversationRepository: {
    list: vi.fn(),
  },
  messageRepository: {},
  settingsRepository: {},
} as unknown as LocalServerServices

let server: ReturnType<typeof createLocalServer>
let baseUrl: URL

beforeEach(async () => {
  vi.clearAllMocks()
  services.conversationRepository.list = vi.fn().mockResolvedValue({ data: [], total: 0 })
  server = createLocalServer(services)
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
  it('answers browser CORS preflight requests', async () => {
    const response = await send({
      method: 'OPTIONS',
      path: '/api/rpc',
    })

    expect(response.statusCode).toBe(204)
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')
    expect(response.headers['access-control-allow-methods']).toBe('GET,POST,OPTIONS')
    expect(response.headers['access-control-allow-headers']).toBe('content-type')
    expect(response.body).toBe('')
  })

  it('keeps CORS headers on RPC responses', async () => {
    const response = await send({
      method: 'POST',
      path: '/api/rpc',
      body: JSON.stringify({
        method: 'chat.getConversations',
        params: { pageIndex: 0, pageSize: 20 },
      }),
    })

    expect(response.statusCode).toBe(200)
    expect(response.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173')
    expect(JSON.parse(response.body)).toEqual({
      success: true,
      data: { data: [], total: 0 },
    })
    expect(services.conversationRepository.list).toHaveBeenCalledWith(0, 20)
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
