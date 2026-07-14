import path from 'node:path'
import { createAppRuntime } from '@ant-chat/backend'
import { listen } from './serverHost'

export interface StartLocalServerOptions {
  appDataRoot: string
  host?: string
  port?: number
  webRoot?: string
}

export interface StartedLocalServer {
  close: () => Promise<void>
  host: string
  port: number
}

export async function startLocalServer(options: StartLocalServerOptions): Promise<StartedLocalServer> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3456
  const webRoot = options.webRoot ?? path.resolve(import.meta.dirname, 'web')
  const runtime = createAppRuntime({
    appDataRoot: options.appDataRoot,
    loggerOptions: {
      fileName: 'ant-chat.log',
      source: 'ant-chat',
    },
  })

  try {
    await runtime.initialize()
    return await listen(runtime, { host, port, webRoot })
  }
  catch (error) {
    await runtime.dispose()
    throw error
  }
}
