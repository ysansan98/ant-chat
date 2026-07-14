import type { AppRuntime } from '@ant-chat/backend'
import path from 'node:path'
import process from 'node:process'
import { createAppRuntime } from '@ant-chat/backend'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { attachAppRuntimeEvents } from '@main/app-runtime-host/electronAppRuntimeEvents'
import { isDev } from '@main/utils/env'
import { app } from 'electron'

let runtime: AppRuntime | null = null

export function getAppRuntime(): AppRuntime {
  if (!runtime) {
    runtime = createAppRuntime({
      appDataRoot: resolveAppDataRoot(),
      contextDiagnosticsEnabled: isDev,
      bashEnvironment: {
        PATH: [resolveBundledCliDirectory(), process.env.PATH].filter(Boolean).join(path.delimiter),
      },
    })
    attachAppRuntimeEvents(runtime)
  }

  return runtime
}

function resolveBundledCliDirectory(): string {
  return path.join(
    app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../../resources'),
    'ant-chat',
  )
}
