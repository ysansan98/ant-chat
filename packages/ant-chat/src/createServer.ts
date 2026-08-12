import type { AppRuntime } from '@ant-chat/backend'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import { createServer as createHttpServer } from 'node:http'

const MAX_RPC_BODY_BYTES = 32 * 1024 * 1024
const RPC_BODY_TIMEOUT_MS = 30_000
const FILE_PATH_PATTERN = /^\/api\/files\/([\w-]+)$/

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

      // 文件服务端点：GET /api/files/:fileId?type=mime/type
      if (req.method === 'GET') {
        const fileMatch = url.pathname.match(FILE_PATH_PATTERN)
        if (fileMatch) {
          const fileId = fileMatch[1]
          const mimeType = url.searchParams.get('type') || 'application/octet-stream'
          await serveAttachmentFile(fileId, mimeType, res, appRuntime)
          return true
        }
        if (url.pathname === '/api/workspace/file') {
          await serveWorkspaceFile(url, req, res, appRuntime)
          return true
        }
      }

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

async function serveAttachmentFile(
  fileId: string,
  mimeType: string,
  res: ServerResponse,
  runtime: AppRuntime,
): Promise<void> {
  try {
    const base64 = await runtime.invoke('files.getAttachmentData', { fileId })
    if (!base64) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ success: false, msg: 'File not found' }))
      return
    }

    const buffer = Buffer.from(base64, 'base64')
    res.writeHead(200, {
      'content-type': mimeType,
      'cache-control': 'public, max-age=86400, immutable',
      'content-length': buffer.length.toString(),
    })
    res.end(buffer)
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, msg: message }))
  }
}

/**
 * 工作区文件流式预览端点：通过 RPC 解析已校验的真实路径与元信息，
 * 再以 Range 请求流式返回文件内容。安全校验在 workspace.resolveFileForStream 完成。
 */
async function serveWorkspaceFile(
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  runtime: AppRuntime,
): Promise<void> {
  const workspacePath = url.searchParams.get('workspacePath') ?? ''
  const relPath = url.searchParams.get('relPath') ?? ''
  if (!workspacePath || !relPath) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, msg: 'workspacePath 与 relPath 不能为空' }))
    return
  }
  let info: { absolutePath: string, size: number, mediaType: string }
  try {
    info = await runtime.invoke('workspace.resolveFileForStream', { workspacePath, relPath })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    res.writeHead(403, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, msg: message }))
    return
  }
  await serveFileWithRange(req, res, info.absolutePath, info.size, info.mediaType)
}

/**
 * 带Range的文件流式响应：支持 bytes=start-end / bytes=start- / bytes=-suffix，
 * 用于视频进度拖动等场景。无 Range 头时全量返回。
 */
async function serveFileWithRange(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  size: number,
  mediaType: string,
): Promise<void> {
  const baseHeaders: Record<string, string> = {
    'content-type': mediaType,
    'accept-ranges': 'bytes',
    'cache-control': 'public, max-age=86400, immutable',
  }

  const rangeHeader = req.headers.range
  if (!rangeHeader) {
    res.writeHead(200, { ...baseHeaders, 'content-length': size.toString() })
    fs.createReadStream(filePath).pipe(res)
    return
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader)
  if (!match) {
    res.writeHead(416, { 'content-range': `bytes */${size}` })
    res.end()
    return
  }

  const isSuffix = match[1] === '' && match[2] !== ''
  let start: number
  let end: number
  if (isSuffix) {
    const n = Number.parseInt(match[2], 10)
    start = Math.max(0, size - n)
    end = size - 1
  }
  else {
    start = Number.parseInt(match[1], 10)
    end = match[2] ? Number.parseInt(match[2], 10) : size - 1
  }

  if (Number.isNaN(start) || start > end || start < 0 || end >= size) {
    res.writeHead(416, { 'content-range': `bytes */${size}` })
    res.end()
    return
  }

  const chunkSize = end - start + 1
  res.writeHead(206, {
    ...baseHeaders,
    'content-range': `bytes ${start}-${end}/${size}`,
    'content-length': chunkSize.toString(),
  })
  fs.createReadStream(filePath, { start, end }).pipe(res)
}
