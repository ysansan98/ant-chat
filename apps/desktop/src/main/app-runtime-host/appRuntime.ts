import type { AppRuntime } from '@ant-chat/app-runtime'
import { createAppRuntime } from '@ant-chat/app-runtime'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { attachAppRuntimeEvents } from '@main/app-runtime-host/electronAppRuntimeEvents'

let runtime: AppRuntime | null = null

export function getAppRuntime(): AppRuntime {
  if (!runtime) {
    runtime = createAppRuntime({
      appDataRoot: resolveAppDataRoot(),
    })
    attachAppRuntimeEvents(runtime)
  }

  return runtime
}
