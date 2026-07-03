import type { RuntimeCore } from './createRuntimeCore'
import type { RuntimeModule } from './runtimeModule'

export function createRuntimeLifecycle(core: Pick<RuntimeCore, 'db' | 'events'>, modules: RuntimeModule[]) {
  let initialized = false
  let disposed = false

  return {
    async initialize() {
      if (initialized)
        return
      if (disposed)
        throw new Error('AppRuntime has been disposed')
      for (const module of modules) {
        await module.initialize?.()
      }
      initialized = true
    },
    async dispose() {
      if (disposed)
        return
      disposed = true
      for (const module of [...modules].reverse()) {
        await module.dispose?.()
      }
      core.events.clear()
      core.db.close()
    },
  }
}
