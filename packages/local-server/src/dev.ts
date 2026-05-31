import type { ApprovePendingActionOptions, IAgentEventEmitter, ILogger, RejectPendingActionOptions, StartAgentTurnOptions } from '@ant-chat/shared'
import type { Server } from 'node:http'
import type { ViteDevServer } from 'vite'
import type { LocalServerServices } from './createServer'
import fs from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import path from 'node:path'
import process from 'node:process'
import { createAgentRuntimeEnvironment } from '@ant-chat/agent-runtime'
import { createLocalApiHandler, createLocalServer } from './createServer'

const DEFAULT_HOST = '127.0.0.1'
const DEFAULT_API_PORT = 17331
const DEFAULT_WEB_PORT = 5173

const logger: ILogger = {
  info: (msg, ...args) => console.info(msg, ...args),
  warn: (msg, ...args) => console.warn(msg, ...args),
  error: (msg, ...args) => console.error(msg, ...args),
}

const eventEmitter: IAgentEventEmitter = {
  emitMessageUpdated() {},
  emitTaskUpdated() {},
  emitApprovalRequired() {},
  emitTurnStarted() {},
  emitTurnChunk() {},
  emitTurnToolCalls() {},
  emitTurnToolResults() {},
  emitTurnFinished() {},
}

const webMode = process.argv.includes('--web')
const workspaceRoot = findWorkspaceRoot(process.cwd())
const port = Number(process.env.ANT_CHAT_LOCAL_SERVER_PORT ?? (webMode ? DEFAULT_WEB_PORT : DEFAULT_API_PORT))
if (!Number.isInteger(port) || port <= 0) {
  throw new Error('ANT_CHAT_LOCAL_SERVER_PORT must be a positive integer')
}

const appDataRoot = process.env.ANT_CHAT_APP_DATA_ROOT ?? path.join(workspaceRoot, '.ant-chat')
const environment = createAgentRuntimeEnvironment({
  appDataRoot,
  eventEmitter,
  logger,
})

environment.appDataServices.workspaceService.ensureInitialized()

const services: LocalServerServices = {
  conversationService: environment.appDataServices.conversationService,
  messageService: environment.appDataServices.messageService,
  settingsService: environment.appDataServices.settingsService,
  profileService: environment.appDataServices.profileService,
  workspaceService: environment.appDataServices.workspaceService,
  providerSettingsRepository: environment.appDataServices.providerSettingsRepository,
  skillService: environment.skillManagementService,
  agentService: {
    startTurn: options => environment.agentService.startTurn(options as StartAgentTurnOptions),
    approvePendingAction: options => environment.agentService.approvePendingAction(options as ApprovePendingActionOptions),
    rejectPendingAction: options => environment.agentService.rejectPendingAction(options as RejectPendingActionOptions),
    cancelTask: taskId => environment.agentService.cancelTask({ taskId }),
    injectSteering: params => environment.agentService.injectSteering(params),
    listActiveTasks: conversationId => environment.agentService.listActiveTasks(conversationId),
    approvePendingActionWithWhitelist: options => environment.agentService.approvePendingActionWithWhitelist(options as ApprovePendingActionOptions & { remember: boolean, workspacePath?: string }),
  },
}

let viteServer: ViteDevServer | null = null
let server: Server | null = null

void main()

function shutdown() {
  if (!server) {
    environment.db?.close()
    process.exit(0)
  }

  server.close(async () => {
    await viteServer?.close()
    environment.db?.close()
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

async function main() {
  server = webMode ? await createWebDevServer() : createLocalServer(services)
  server.listen(port, DEFAULT_HOST, () => {
    console.info(`Ant Chat ${webMode ? 'web dev server' : 'local API'} listening on http://${DEFAULT_HOST}:${port}`)
    console.info(`App data root: ${appDataRoot}`)
  })
}

async function createWebDevServer() {
  const localApiHandler = createLocalApiHandler(services)
  const httpServer = createHttpServer(async (req, res) => {
    if (await localApiHandler(req, res))
      return

    if (!viteServer) {
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Vite dev server is not ready')
      return
    }

    viteServer.middlewares(req, res, (error: unknown) => {
      if (error) {
        if (error instanceof Error)
          viteServer?.ssrFixStacktrace(error)
        console.error(error)
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(error instanceof Error ? error.message : String(error))
        return
      }

      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Not found')
    })
  })

  const { createServer: createViteServer } = await import('vite')
  viteServer = await createViteServer({
    configFile: path.join(workspaceRoot, 'apps/web/vite.config.ts'),
    root: path.join(workspaceRoot, 'apps/web'),
    server: {
      middlewareMode: true,
      hmr: {
        server: httpServer,
      },
    },
    appType: 'spa',
  })

  return httpServer
}

function findWorkspaceRoot(start: string): string {
  let current = start
  while (true) {
    if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    const parent = path.dirname(current)
    if (parent === current) {
      return start
    }
    current = parent
  }
}
