import type { AppRuntime } from '@ant-chat/backend'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import { createServer as createHttpServer } from 'node:http'

const MAX_RPC_BODY_BYTES = 32 * 1024 * 1024
const RPC_BODY_TIMEOUT_MS = 30_000

class RpcRequestError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message)
    this.name = 'RpcRequestError'
  }
}

export interface RpcLimits {
  maxBodyBytes?: number
  bodyTimeoutMs?: number
}

export type LocalApiHandler = (req: IncomingMessage, res: ServerResponse) => Promise<boolean>

export function createLocalServer(runtime: object, limits?: RpcLimits) {
  const handleLocalApiRequest = createLocalApiHandler(runtime, limits)

  return createHttpServer(async (req, res) => {
    const handled = await handleLocalApiRequest(req, res)
    if (handled)
      return

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, msg: `Unknown local API route: ${req.url || '/'}` }))
  })
}

export function createLocalApiHandler(runtime: object, limits?: RpcLimits): LocalApiHandler {
  const appRuntime = runtime as AppRuntime
  const maxBodyBytes = limits?.maxBodyBytes ?? MAX_RPC_BODY_BYTES
  const bodyTimeoutMs = limits?.bodyTimeoutMs ?? RPC_BODY_TIMEOUT_MS

  return async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost')
      if (!isLocalApiRoute(url))
        return false

      if (req.method === 'OPTIONS') {
        res.writeHead(204)
        res.end()
        return true
      }

      const body = await readJsonBody(req, maxBodyBytes, bodyTimeoutMs)
      const result = await routeRequest(url, body, appRuntime)

      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: true, data: result }))
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const statusCode = error instanceof RpcRequestError ? error.statusCode : 500
      res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, msg: message }))
    }
    return true
  }
}

function isLocalApiRoute(url: URL): boolean {
  return url.pathname.startsWith('/api/')
}

async function routeRequest(url: URL, body: unknown, runtime: AppRuntime): Promise<unknown> {
  if (url.pathname === '/api/rpc') {
    return dispatchRpc(body, runtime)
  }

  throw new Error(`Unknown local API route: ${url.pathname}`)
}

async function dispatchRpc(body: unknown, runtime: AppRuntime): Promise<unknown> {
  const { method, input } = parseRpcBody(body)
  return runtime.invoke(method as never, input as never)
}

function parseRpcBody(body: unknown): { method: string, input: unknown } {
  const data = asRecord(body, 'RPC body')
  const method = stringParam(data.method)
  return { method, input: data.input }
}

function asRecord(value: unknown, name = 'object'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Invalid ${name}`)
  }
  return value as Record<string, unknown>
}

function stringParam(value: unknown): string {
  if (typeof value !== 'string') {
    throw new TypeError('Invalid string parameter')
  }
  return value
}

async function readJsonBody(
  req: IncomingMessage,
  maxBytes = MAX_RPC_BODY_BYTES,
  timeoutMs = RPC_BODY_TIMEOUT_MS,
): Promise<unknown> {
  const chunks: Buffer[] = []
  let totalBytes = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new RpcRequestError('请求体读取超时', 408))
    }, timeoutMs)
  })

  try {
    const readPromise = (async () => {
      for await (const chunk of req) {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        totalBytes += buf.length
        if (totalBytes > maxBytes) {
          throw new RpcRequestError('请求体超过大小限制', 413)
        }
        chunks.push(buf)
      }
    })()

    await Promise.race([readPromise, timeoutPromise])
  }
  finally {
    if (timer) {
      clearTimeout(timer)
    }
  }

  if (chunks.length === 0) {
    return undefined
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}
