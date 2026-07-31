import type { AppRuntime } from '@ant-chat/backend'
import path from 'node:path'
import process from 'node:process'
import { activateAppRuntime } from '@ant-chat/backend'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { attachAppRuntimeEvents } from '@main/app-runtime-host/electronAppRuntimeEvents'
import { startOAuthCallbackServer } from '@main/app-runtime-host/oauthCallbackServer'
import { app } from 'electron'
import { createRuntimeHost } from './runtimeHost'

const runtimeHost = createRuntimeHost(createDesktopAppRuntime, attachAppRuntimeEvents)

let stopOAuthServer: (() => void) | undefined

export function getAppRuntime(): AppRuntime {
  return runtimeHost.get()
}

/** 是否已进入退出流程（dispose 已开始）。关闭中的 RPC 失败属于预期噪音。 */
export function isDesktopAppRuntimeShuttingDown(): boolean {
  return runtimeHost.isShuttingDown()
}

export function activateDesktopAppRuntime(): Promise<AppRuntime> {
  return runtimeHost.activate()
}

export function disposeDesktopAppRuntime(): Promise<void> {
  const stop = stopOAuthServer
  stopOAuthServer = undefined
  return Promise.resolve(stop?.()).then(() => runtimeHost.dispose())
}

async function createDesktopAppRuntime(): Promise<AppRuntime> {
  const oauthCallbackServer = await startOAuthCallbackServer()
  stopOAuthServer = () => oauthCallbackServer.dispose()
  try {
    return await activateAppRuntime({
      appDataRoot: resolveAppDataRoot(),
      commandEnvironment: {
        PATH: [resolveBundledCliDirectory(), process.env.PATH].filter(Boolean).join(path.delimiter),
      },
      oauthCallbackHost: oauthCallbackServer.host,
    })
  }
  catch (error) {
    stopOAuthServer = undefined
    await oauthCallbackServer.dispose()
    throw error
  }
}

function resolveBundledCliDirectory(): string {
  return path.join(
    app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../resources'),
    'ant-chat',
  )
}
