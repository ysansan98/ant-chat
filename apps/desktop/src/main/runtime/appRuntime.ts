import type { AppRuntime } from '@ant-chat/app-runtime'
import { createAppRuntime } from '@ant-chat/app-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { attachAppRuntimeEvents } from '@main/runtime/electronAppRuntimeEvents'
import { logger } from '@main/utils/logger'
import { ProxyManager } from '@main/utils/proxy-manager'
import { testProxyConnection } from '@main/utils/system-proxy'

let runtime: AppRuntime | null = null

export function getAppRuntime(): AppRuntime {
  if (!runtime) {
    runtime = createAppRuntime({
      appDataRoot: resolveAppDataRoot(),
      host: {
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
