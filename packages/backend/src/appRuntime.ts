import type { AppRpcInput, AppRpcMethod, AppRpcOutput } from '@ant-chat/shared'
import type { CommandHost } from './agent-core/native-tools/command/types'
import type { RuntimeCore } from './app-runtime/createRuntimeCore'
import type { RuntimeActivation } from './app-runtime/runtimeActivation'
import type { CreateAppRuntimeOptions } from './app-runtime/types'
import process from 'node:process'
import { LocalControlServer } from './app-control/localControlServer'
import { detectCommandHost } from './app-runtime/commandHost'
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
    const commandHost = detectCommandHostSafely(options)
    core = createRuntimeCore(options, commandHost)
    if (commandHost.status === 'available') {
      core.logger.info('命令宿主已固定', {
        platform: commandHost.platform,
        interpreter: commandHost.interpreter,
        executablePath: commandHost.executablePath,
      })
    }
    else {
      core.logger.warn('命令执行功能不可用', {
        platform: commandHost.platform,
        candidates: commandHost.candidates,
        reason: commandHost.reason,
      })
    }
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

function detectCommandHostSafely(options: CreateAppRuntimeOptions): CommandHost {
  try {
    return (options.commandHostDetector ?? detectCommandHost)({
      environment: {
        ...process.env,
        ...options.commandEnvironment,
      },
    })
  }
  catch (error) {
    return {
      status: 'unavailable',
      platform: process.platform === 'win32' ? 'windows' : 'posix',
      candidates: [],
      reason: `命令宿主探测失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
