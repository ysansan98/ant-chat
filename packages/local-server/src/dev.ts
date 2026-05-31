import type { AgentPendingAction, AgentTaskSnapshot, IAgentEventEmitter, IMessage } from '@ant-chat/shared'
import type { ServerResponse } from 'node:http'
import type { LocalServerServices } from './createServer'
import { createServer as createHttpServer } from 'node:http'
import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { createAgentRuntimeEnvironment } from '@ant-chat/agent-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { createLocalApiHandler } from './createServer'

const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  'connection': 'keep-alive',
}

// SSE channel names match Electron IPC channel names used by consumers
function sseBroadcast(clients: Set<ServerResponse>, channel: string, data: unknown) {
  const payload = `event: ${channel}\ndata: ${JSON.stringify(data)}\n\n`
  for (const client of clients) {
    client.write(payload)
  }
}

export function createSseEventEmitter(clients: Set<ServerResponse>): IAgentEventEmitter {
  return {
    emitMessageUpdated(message: IMessage) {
      sseBroadcast(clients, 'message:updated', message)
    },
    emitTaskUpdated(task: AgentTaskSnapshot) {
      sseBroadcast(clients, 'agent:state-updated', { task })
    },
    emitApprovalRequired(taskId: string, _conversationId: string, pendingAction: AgentPendingAction) {
      sseBroadcast(clients, 'agent:approval-required', { taskId, pendingAction })
    },
    emitTurnStarted() {},
    emitTurnChunk() {},
    emitTurnToolCalls() {},
    emitTurnToolResults() {},
    emitTurnFinished() {},
  }
}

function createDevLogger() {
  return {
    info: (msg: string, ...args: unknown[]) => console.log(`[local-server] ${msg}`, ...args),
    warn: (msg: string, ...args: unknown[]) => console.warn(`[local-server] ${msg}`, ...args),
    error: (msg: string, ...args: unknown[]) => console.error(`[local-server] ${msg}`, ...args),
  }
}

function buildServices(env: ReturnType<typeof createAgentRuntimeEnvironment>): LocalServerServices {
  return {
    conversationService: env.appDataServices.conversationService,
    messageService: env.appDataServices.messageService,
    settingsService: env.appDataServices.settingsService,
    providerSettingsRepository: env.appDataServices.providerSettingsRepository,
    profileService: {
      readProfile: () => env.appDataServices.profileService.readProfile(),
      updateProfile: input => env.appDataServices.profileService.updateProfile(input),
      rollbackSoul: () => env.appDataServices.profileService.rollbackSoul(),
    },
    workspaceService: env.appDataServices.workspaceService,
    agentService: env.agentService as unknown as LocalServerServices['agentService'],
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

  const env = createAgentRuntimeEnvironment({
    appDataRoot: resolveAppDataRoot(),
    eventEmitter: createSseEventEmitter(sseClients),
    logger: createDevLogger(),
  })

  const services = buildServices(env)
  const handleLocalApi = createLocalApiHandler(services)

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
      server: { middlewareMode: true },
    })
    viteMiddleware = viteServer.middlewares as unknown as typeof viteMiddleware
    console.log(`[local-server] Vite middleware attached (root: ${webRoot})`)
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
    console.log(`[local-server] listening on http://127.0.0.1:${port}`)
    console.log(`[local-server] SSE endpoint: http://127.0.0.1:${port}/api/events`)
    if (withWeb) {
      console.log(`[local-server] Web UI: http://127.0.0.1:${port}`)
    }
  })

  const shutdown = () => {
    console.log('\n[local-server] shutting down...')
    for (const client of sseClients) {
      client.end()
    }
    sseClients.clear()
    if (env.db) {
      env.db.close()
    }
    server.close(() => process.exit(0))
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main()
