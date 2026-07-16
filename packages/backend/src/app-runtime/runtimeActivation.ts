export interface RuntimeActivationLifecycle {
  initialize: () => Promise<void>
  dispose: () => Promise<void>
}

export interface RuntimeControlEndpoint {
  reserve: () => void
  start: () => Promise<void>
  stopListening: () => Promise<void>
  releaseReservation: () => void
}

export interface RuntimeActivation {
  activate: () => Promise<void>
  dispose: () => Promise<void>
}

/**
 * 把单实例锁、业务模块和控制端点收进一个原子激活 module。
 * 激活顺序保证未获得锁时没有业务副作用；释放严格按相反顺序进行。
 */
export function createRuntimeActivation(
  lifecycle: RuntimeActivationLifecycle,
  controlEndpoint: RuntimeControlEndpoint,
): RuntimeActivation {
  let disposed = false

  async function release(): Promise<void> {
    const errors: unknown[] = []
    try {
      await controlEndpoint.stopListening()
    }
    catch (error) {
      errors.push(error)
    }
    try {
      await lifecycle.dispose()
    }
    catch (error) {
      errors.push(error)
    }
    try {
      controlEndpoint.releaseReservation()
    }
    catch (error) {
      errors.push(error)
    }
    if (errors.length > 0)
      throw errors[0]
  }

  return {
    async activate(): Promise<void> {
      if (disposed)
        throw new Error('AppRuntime 激活器已释放')
      try {
        controlEndpoint.reserve()
        await lifecycle.initialize()
        await controlEndpoint.start()
      }
      catch (error) {
        disposed = true
        await release().catch(() => {})
        throw error
      }
    },
    async dispose(): Promise<void> {
      if (disposed)
        return
      disposed = true
      await release()
    },
  }
}
