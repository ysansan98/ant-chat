import type { ServerResponse } from 'node:http'
import { createServer as createHttpServer } from 'node:http'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { createAppRuntime, resolveAgentBrowserExecutablePath } from '@ant-chat/app-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { Agent, EnvHttpProxyAgent, fetch, setGlobalDispatcher } from 'undici'
import { createLocalApiHandler } from './createServer'

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  'connection': 'keep-alive',
}

const initialProxyEnv = {
  HTTP_PROXY: process.env.HTTP_PROXY,
  HTTPS_PROXY: process.env.HTTPS_PROXY,
  NO_PROXY: process.env.NO_PROXY,
  http_proxy: process.env.http_proxy,
  https_proxy: process.env.https_proxy,
  no_proxy: process.env.no_proxy,
}

let currentProxyUrl: string | undefined

function sseBroadcast(clients: Set<ServerResponse>, channel: string, data: unknown) {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    client.write(payload)
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '3456' },
      web: { type: 'boolean', default: false },
    },
    strict: false,
  })

  const port = Number(values.port) || 3456
  const withWeb = values.web as boolean
  const sseClients = new Set<ServerResponse>()
  const appDataRoot = resolveAppDataRoot()
  const runtime = createAppRuntime({
    appDataRoot,
    host: {
      browser: {
        executablePath: resolveAgentBrowserExecutablePath(),
        get proxyUrl() { return currentProxyUrl },
      },
      proxy: {
        async apply(settings) {
          if (settings.mode === 'custom' && settings.customProxyUrl) {
            currentProxyUrl = settings.customProxyUrl
            setProcessProxy(settings.customProxyUrl)
            setGlobalDispatcher(new EnvHttpProxyAgent({
              httpProxy: settings.customProxyUrl,
              httpsProxy: settings.customProxyUrl,
              noProxy: 'localhost,127.0.0.1,0.0.0.0,[::1],::1',
            }))
          }
          else if (settings.mode === 'system') {
            currentProxyUrl = undefined
            restoreSystemProxy()
            setGlobalDispatcher(new EnvHttpProxyAgent())
          }
          else {
            currentProxyUrl = undefined
            clearProcessProxy()
            setGlobalDispatcher(new Agent())
          }
        },
        async test(proxyUrl) {
          const dispatcher = new EnvHttpProxyAgent({
            httpProxy: proxyUrl,
            httpsProxy: proxyUrl,
          })
          try {
            const response = await fetch('https://www.google.com/generate_204', {
              dispatcher,
              signal: AbortSignal.timeout(10_000),
            })
            return response.ok
          }
          finally {
            await dispatcher.close()
          }
        },
      },
    },
  })
  await runtime.initialize()
  const handleLocalApi = createLocalApiHandler(runtime)

  runtime.events.on('message.updated', ({ message }) => sseBroadcast(sseClients, 'message:updated', message))
  runtime.events.on('agent.task.updated', ({ task }) => sseBroadcast(sseClients, 'agent:state-updated', { task }))
  runtime.events.on('agent.approval.required', event => sseBroadcast(sseClients, 'agent:approval-required', event))
  runtime.events.on('workspace.changed', event => sseBroadcast(sseClients, 'workspace:changed', event))
  runtime.events.on('provider.changed', event => sseBroadcast(sseClients, 'provider:changed', event))
  runtime.events.on('settings.changed', event => sseBroadcast(sseClients, 'settings:updated', event))
  runtime.events.on('mcp.connection.changed', event =>
    sseBroadcast(sseClients, 'mcp:McpServerStatusChanged', [event.serverName, event.status]))

  // SSE endpoint: browser connects here for real-time events
  function handleSse(req: import('node:http').IncomingMessage, res: ServerResponse): boolean {
    if (req.url === '/api/events' && req.method === 'GET') {
      for (const [key, value] of Object.entries(SSE_HEADERS)) {
        res.setHeader(key, value)
      }
      res.writeHead(200)
      res.write(': connected\n\n')
      sseClients.add(res)
      req.on('close', () => sseClients.delete(res))
      return true
    }
    return false
  }

  // In --web mode, create Vite dev server for HMR + frontend serving
  let viteMiddleware: ((req: import('node:http').IncomingMessage, res: ServerResponse, next: () => void) => void) | undefined
  if (withWeb) {
    const vite = await import('vite')
    const webRoot = resolve(process.cwd(), '../../apps/web')
    const viteServer = await vite.createServer({
      root: webRoot,
      appType: 'spa',
      server: { middlewareMode: true },
    })
    viteMiddleware = viteServer.middlewares as unknown as typeof viteMiddleware
    console.info('Vite middleware attached', { root: webRoot })
  }

  const server = createHttpServer(async (req, res) => {
    if (handleSse(req, res))
      return

    const handled = await handleLocalApi(req, res)
    if (handled)
      return

    // Non-API routes: delegate to Vite if available, otherwise 404
    if (viteMiddleware) {
      viteMiddleware(req, res, () => {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ success: false, msg: `Unknown route: ${req.url || '/'}` }))
      })
      return
    }

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ success: false, msg: `Unknown route: ${req.url || '/'}` }))
  })

  server.listen(port, '127.0.0.1', () => {
    console.info(`listening on http://127.0.0.1:${port}`)
    console.info(`SSE endpoint: http://127.0.0.1:${port}/api/events`)
    if (withWeb) {
      console.info(`Web UI: http://127.0.0.1:${port}`)
    }
  })

  const shutdown = async () => {
    console.info('shutting down')
    for (const client of sseClients) {
      client.end()
    }
    sseClients.clear()
    await runtime.dispose()
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

function setProcessProxy(proxyUrl: string): void {
  const noProxy = 'localhost,127.0.0.1,0.0.0.0,[::1],::1'
  process.env.HTTP_PROXY = proxyUrl
  process.env.HTTPS_PROXY = proxyUrl
  process.env.NO_PROXY = noProxy
  process.env.http_proxy = proxyUrl
  process.env.https_proxy = proxyUrl
  process.env.no_proxy = noProxy
}

function restoreSystemProxy(): void {
  clearProcessProxy()
  for (const [key, value] of Object.entries(initialProxyEnv)) {
    if (value !== undefined) {
      process.env[key] = value
    }
  }
}

function clearProcessProxy(): void {
  for (const key of Object.keys(initialProxyEnv)) {
    delete process.env[key]
  }
}

main()
