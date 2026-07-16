import type { AppRpcInput, AppRpcMethod, AppRpcOutput } from '@ant-chat/shared'
import type { RuntimeCore } from './app-runtime/createRuntimeCore'
import type { RuntimeActivation } from './app-runtime/runtimeActivation'
import type { CreateAppRuntimeOptions } from './app-runtime/types'
import { LocalControlServer } from './app-control/localControlServer'
import { createRuntimeCore } from './app-runtime/createRuntimeCore'
import { createRuntimeLifecycle } from './app-runtime/lifecycle'
import { registerRuntimeModules } from './app-runtime/register-modules'
import { RouteRegistry } from './app-runtime/routeRegistry'
import { createRuntimeActivation } from './app-runtime/runtimeActivation'

export type { CreateAppRuntimeOptions } from './app-runtime/types'

export interface AppRuntime {
  events: RuntimeCore['events']
  getModule: <TModule>(moduleType: { prototype: TModule }) => TModule
  invoke: <TMethod extends AppRpcMethod>(method: TMethod, input: AppRpcInput<TMethod>) => Promise<AppRpcOutput<TMethod>>
  dispose: () => Promise<void>
}

/**
 * 原子激活 AppRuntime。返回前 lifecycle、单实例锁和控制端点均已就绪；
 * 任一步失败都会逆序释放已经激活的资源。
 */
export async function activateAppRuntime(options: CreateAppRuntimeOptions): Promise<AppRuntime> {
  // 单实例锁必须先于 DB 和任何 module 构造，拒绝第二实例时不产生业务副作用。
  const controlServer = new LocalControlServer(null, {
    appDataRoot: options.appDataRoot,
  })
  controlServer.reserve()
  let core: RuntimeCore | undefined
  let activation: RuntimeActivation | undefined

  try {
    core = createRuntimeCore(options)
    const modules = registerRuntimeModules(core)
    const routes = new RouteRegistry()
    for (const module of modules.routes) {
      routes.register(module)
    }
    routes.registerRoutes(modules.routeBindings)
    controlServer.attachAppControl(modules.appControl)

    const lifecycle = createRuntimeLifecycle(core, modules.lifecycle)
    activation = createRuntimeActivation(lifecycle, controlServer)

    const runtime: AppRuntime = {
      events: core.events,
      getModule: <TModule>(moduleType: { prototype: TModule }) => routes.getModule(moduleType),
      invoke<TMethod extends AppRpcMethod>(method: TMethod, input: AppRpcInput<TMethod>): Promise<AppRpcOutput<TMethod>> {
        return routes.invoke(method, input)
      },
      async dispose(): Promise<void> {
        await activation!.dispose()
      },
    }

    await activation.activate()
    return runtime
  }
  catch (error) {
    if (activation) {
      await activation.dispose().catch(() => {})
    }
    else {
      core?.events.clear()
      core?.db.close()
      controlServer.releaseReservation()
    }
    throw error
  }
}
