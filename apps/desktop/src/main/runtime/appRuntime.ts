import type { AppRuntime } from '@ant-chat/app-runtime'
import { createAppRuntime, resolveAgentBrowserExecutablePath } from '@ant-chat/app-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { attachAppRuntimeEvents } from '@main/runtime/electronAppRuntimeEvents'
import { isProd } from '@main/utils/env'
import { logger } from '@main/utils/logger'
import { ProxyManager } from '@main/utils/proxy-manager'
import { testProxyConnection } from '@main/utils/system-proxy'
import { getResourcePath } from '@main/utils/util'

let runtime: AppRuntime | null = null

export function getAppRuntime(): AppRuntime {
  if (!runtime) {
    runtime = createAppRuntime({
      appDataRoot: resolveAppDataRoot(),
      host: {
        browser: {
          executablePath: resolveAgentBrowserExecutablePath({
            resourcesPath: isProd ? getResourcePath() : undefined,
          }),
        },
        proxy: {
          apply: settings => ProxyManager.getInstance().updateProxySettings(settings),
          test: testProxyConnection,
        },
      },
      logger,
    })
    attachAppRuntimeEvents(runtime)
  }

  return runtime
}
