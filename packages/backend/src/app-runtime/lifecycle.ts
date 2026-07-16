import type { RuntimeCore } from './createRuntimeCore'
import type { RuntimeModule } from './runtimeModule'

export interface RuntimeLifecycle {
  initialize: () => Promise<void>
  dispose: () => Promise<void>
}

export function createRuntimeLifecycle(
  core: Pick<RuntimeCore, 'db' | 'events'>,
  modules: RuntimeModule[],
): RuntimeLifecycle {
  let initialized = false
  let disposed = false
  const activeModules: RuntimeModule[] = []

  async function release(): Promise<void> {
    const errors: unknown[] = []
    for (const module of [...activeModules].reverse()) {
      try {
        await module.dispose?.()
      }
      catch (error) {
        errors.push(error)
      }
    }
    activeModules.length = 0
    try {
      core.events.clear()
    }
    catch (error) {
      errors.push(error)
    }
    try {
      core.db.close()
    }
    catch (error) {
      errors.push(error)
    }
    if (errors.length > 0)
      throw errors[0]
  }

  return {
    async initialize() {
      if (initialized)
        return
      if (disposed)
        throw new Error('AppRuntime 已释放')
      try {
        for (const module of modules) {
          // initialize 可能在产生部分副作用后失败，因此先登记，确保失败模块也会 dispose。
          activeModules.push(module)
          await module.initialize?.()
        }
      }
      catch (error) {
        disposed = true
        await release().catch(() => {})
        throw error
      }
      initialized = true
    },
    async dispose() {
      if (disposed)
        return
      disposed = true
      await release()
    },
  }
}
