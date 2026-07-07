import type { AppRpcInput, AppRpcMethod, AppRpcOutput } from '@ant-chat/shared'
import type { CreateAppRuntimeOptions } from './app-runtime/types'
import { LocalControlServer } from './app-control/localControlServer'
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

  const controlServer = new LocalControlServer(modules.appControl, {
    appDataRoot: options.appDataRoot,
  })

  const lifecycle = createRuntimeLifecycle(core, modules.lifecycle)

  return {
    events: core.events,
    appControl: modules.appControl,
    controlServer,
    getModule: <TModule>(moduleType: { prototype: TModule }) => routes.getModule(moduleType),
    invoke<TMethod extends AppRpcMethod>(method: TMethod, input: AppRpcInput<TMethod>): Promise<AppRpcOutput<TMethod>> {
      return routes.invoke(method, input)
    },
    async initialize() {
      await lifecycle.initialize()
      // 控制 Socket 在运行时初始化完成后启动
      await controlServer.start().catch((err: Error) => {
        core.logger.warn?.('Failed to start control server', err)
      })
    },
    async dispose() {
      // 先停控制 Socket，再关闭运行时
      await controlServer.stop().catch(() => {})
      await lifecycle.dispose()
    },
  }
}

export type AppRuntime = ReturnType<typeof createAppRuntime>
