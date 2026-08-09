import type { AppRuntime } from '@ant-chat/backend'
import path from 'node:path'
import process from 'node:process'
import { activateAppRuntime } from '@ant-chat/backend'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { attachAppRuntimeEvents } from '@main/app-runtime-host/electronAppRuntimeEvents'
import { startOAuthCallbackServer } from '@main/app-runtime-host/oauthCallbackServer'
import { app } from 'electron'
import { mergeCommandPath, resolveLoginShellPath } from './loginShellPath'
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
    // 打包后 GUI 应用由 launchd 启动，PATH 不含用户 shell 注入的目录（nvm 等），
    // execute_command 因此找不到 node 等用户工具；仅在打包且非 Windows 时把
    // login shell 的 PATH 合并进来。dev 模式继承终端环境，Windows 的 GUI 会话
    // PATH 已含用户系统 PATH，都不需要。
    const loginShellPath = app.isPackaged && process.platform !== 'win32'
      ? await resolveLoginShellPath()
      : undefined
    return await activateAppRuntime({
      appDataRoot: resolveAppDataRoot(),
      commandEnvironment: {
        PATH: mergeCommandPath(resolveBundledCliDirectory(), loginShellPath, process.env.PATH)
          || process.env.PATH
          || '',
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
