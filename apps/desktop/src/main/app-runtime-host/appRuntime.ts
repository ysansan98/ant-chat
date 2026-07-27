import type { AppRuntime } from '@ant-chat/backend'
import path from 'node:path'
import process from 'node:process'
import { activateAppRuntime } from '@ant-chat/backend'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { attachAppRuntimeEvents } from '@main/app-runtime-host/electronAppRuntimeEvents'
import { app } from 'electron'
import { createRuntimeHost } from './runtimeHost'

const runtimeHost = createRuntimeHost(createDesktopAppRuntime, attachAppRuntimeEvents)

export function getAppRuntime(): AppRuntime {
  return runtimeHost.get()
}

export function activateDesktopAppRuntime(): Promise<AppRuntime> {
  return runtimeHost.activate()
}

export function disposeDesktopAppRuntime(): Promise<void> {
  return runtimeHost.dispose()
}

function createDesktopAppRuntime(): Promise<AppRuntime> {
  return activateAppRuntime({
    appDataRoot: resolveAppDataRoot(),
    commandEnvironment: {
      PATH: [resolveBundledCliDirectory(), process.env.PATH].filter(Boolean).join(path.delimiter),
    },
  })
}

function resolveBundledCliDirectory(): string {
  return path.join(
    app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../resources'),
    'ant-chat',
  )
}
