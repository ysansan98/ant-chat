import type { AppRuntime, AppRuntimeEventName, AppRuntimeEvents } from '@ant-chat/backend'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import fs from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import path from 'node:path'
import { APP_RENDERER_EVENT_NAMES } from '@ant-chat/shared'
import { createLocalApiHandler } from './createServer'

const SSE_HEADERS = {
  'cache-control': 'no-cache',
  'connection': 'keep-alive',
  'content-type': 'text/event-stream',
}

const CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

interface ListenOptions {
  host: string
  port: number
  webRoot: string
  webHandler?: (req: IncomingMessage, res: ServerResponse) => void
}

export interface LocalServerHost {
  close: () => Promise<void>
  host: string
  port: number
}

export async function listen(runtime: AppRuntime, options: ListenOptions): Promise<LocalServerHost> {
  const handleLocalApi = createLocalApiHandler(runtime)
  const sseClients = new Set<ServerResponse>()
  const removeEventListeners = APP_RENDERER_EVENT_NAMES.map(name =>
    runtime.events.on(name, event => broadcast(sseClients, name, event)),
  )

  const server = createHttpServer(async (req, res) => {
    if (handleSse(req, res, sseClients))
      return

    const handled = await handleLocalApi(req, res)
    if (handled)
      return

    if (options.webHandler) {
      options.webHandler(req, res)
      return
    }

    serveWebAsset(req, res, options.webRoot)
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.port, options.host, () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo
  let closing: Promise<void> | undefined

  return {
    host: options.host,
    port: address.port,
    close() {
      closing ??= closeServer()
      return closing
    },
  }

  async function closeServer(): Promise<void> {
    for (const removeListener of removeEventListeners)
      removeListener()
    for (const client of sseClients)
      client.end()
    sseClients.clear()

    try {
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    }
    finally {
      await runtime.dispose()
    }
  }
}

function handleSse(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>): boolean {
  if (req.url !== '/api/events' || req.method !== 'GET')
    return false

  for (const [key, value] of Object.entries(SSE_HEADERS))
    res.setHeader(key, value)
  res.writeHead(200)
  res.write(': connected\n\n')
  clients.add(res)
  req.on('close', () => clients.delete(res))
  return true
}

function broadcast<K extends AppRuntimeEventName>(
  clients: Set<ServerResponse>,
  channel: K,
  data: AppRuntimeEvents[K],
): void {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients)
    client.write(payload)
}

function serveWebAsset(req: IncomingMessage, res: ServerResponse, webRoot: string): void {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    writeNotFound(req, res)
    return
  }

  const url = new URL(req.url || '/', 'http://localhost')
  let requestedPath: string
  try {
    requestedPath = decodeURIComponent(url.pathname)
  }
  catch {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, msg: '请求路径无效' }))
    return
  }

  const relativePath = requestedPath === '/' ? 'index.html' : requestedPath.slice(1)
  const assetPath = resolveWebPath(webRoot, relativePath)
  let filePath = assetPath && isFile(assetPath) ? assetPath : undefined
  if (!filePath && path.extname(relativePath) === '')
    filePath = path.join(webRoot, 'index.html')

  if (!isFile(filePath)) {
    writeNotFound(req, res)
    return
  }

  res.writeHead(200, {
    'content-type': CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  fs.createReadStream(filePath).pipe(res)
}

function resolveWebPath(webRoot: string, relativePath: string): string | undefined {
  const resolvedRoot = path.resolve(webRoot)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`))
    return undefined
  return resolvedPath
}

function isFile(filePath: string | undefined): filePath is string {
  if (!filePath)
    return false
  try {
    return fs.statSync(filePath).isFile()
  }
  catch {
    return false
  }
}

function writeNotFound(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify({ success: false, msg: `Unknown route: ${req.url || '/'}` }))
}
