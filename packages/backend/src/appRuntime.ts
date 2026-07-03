import type { AppRpcInput, AppRpcMethod, AppRpcOutput } from '@ant-chat/shared'
import type { CreateAppRuntimeOptions } from './app-runtime/types'
import { createRuntimeCore } from './app-runtime/createRuntimeCore'
import { createRuntimeLifecycle } from './app-runtime/lifecycle'
import { registerRuntimeModules } from './app-runtime/register-modules'
import { RouteRegistry } from './app-runtime/routeRegistry'

export type { CreateAppRuntimeOptions } from './app-runtime/types'

export function createAppRuntime(options: CreateAppRuntimeOptions) {
  const core = createRuntimeCore(options)
  const modules = registerRuntimeModules(core)
  const routes = new RouteRegistry()
  for (const module of modules.routes) {
    routes.register(module)
  }

  return {
    events: core.events,
    getModule: <TModule>(moduleType: { prototype: TModule }) => routes.getModule(moduleType),
    invoke<TMethod extends AppRpcMethod>(method: TMethod, input: AppRpcInput<TMethod>): Promise<AppRpcOutput<TMethod>> {
      return routes.invoke(method, input)
    },
    ...createRuntimeLifecycle(core, modules.lifecycle),
  }
}

export type AppRuntime = ReturnType<typeof createAppRuntime>
