import { resolve } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { createAppRuntime } from '@ant-chat/app-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { listen } from './serverHost'

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
  const appDataRoot = resolveAppDataRoot()
  const runtime = createAppRuntime({
    appDataRoot,
    loggerOptions: {
      fileName: 'local-server.log',
      source: 'local-server',
    },
  })
  await runtime.initialize()

  // 开发模式使用 Vite 中间件，同时提供 HMR 和前端页面。
  let webHandler: Parameters<typeof listen>[1]['webHandler']
  if (withWeb) {
    const vite = await import('vite')
    const webRoot = resolve(process.cwd(), '../../apps/web')
    const viteServer = await vite.createServer({
      root: webRoot,
      appType: 'spa',
      server: { middlewareMode: true },
    })
    webHandler = (req, res) => {
      viteServer.middlewares(req, res, () => {
        res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ success: false, msg: `Unknown route: ${req.url || '/'}` }))
      })
    }
    console.info('Vite middleware attached', { root: webRoot })
  }

  const server = await listen(runtime, {
    host: '0.0.0.0',
    port,
    webHandler,
    webRoot: resolve(process.cwd(), '../../apps/web/dist'),
  })

  console.info(`listening on http://0.0.0.0:${server.port}`)
  console.info(`SSE endpoint: http://0.0.0.0:${server.port}/api/events`)
  if (withWeb)
    console.info(`Web UI: http://0.0.0.0:${server.port}`)

  const shutdown = async () => {
    console.info('shutting down')
    await server.close()
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

main()
