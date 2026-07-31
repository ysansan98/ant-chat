export interface HostRuntime {
  dispose: () => Promise<void>
}

export interface RuntimeHost<TRuntime extends HostRuntime> {
  get: () => TRuntime
  /** 是否已进入关闭流程（dispose 已开始）。用于区分「尚未激活」与「正在关闭」。 */
  isShuttingDown: () => boolean
  activate: () => Promise<TRuntime>
  dispose: () => Promise<void>
}

/** 单例 host：只发布 fully-active runtime，并让退出等待正在进行的激活。 */
export function createRuntimeHost<TRuntime extends HostRuntime>(
  activateRuntime: () => Promise<TRuntime>,
  onActivated: (runtime: TRuntime) => void,
): RuntimeHost<TRuntime> {
  let runtime: TRuntime | null = null
  let activation: Promise<TRuntime> | null = null
  let shuttingDown = false

  return {
    get(): TRuntime {
      if (!runtime)
        throw new Error('AppRuntime 尚未完成激活')
      return runtime
    },
    isShuttingDown(): boolean {
      return shuttingDown
    },
    activate(): Promise<TRuntime> {
      if (runtime)
        return Promise.resolve(runtime)
      if (!activation) {
        activation = activateRuntime().then((activeRuntime) => {
          onActivated(activeRuntime)
          runtime = activeRuntime
          return activeRuntime
        }).finally(() => {
          activation = null
        })
      }
      return activation
    },
    async dispose(): Promise<void> {
      shuttingDown = true
      if (activation) {
        try {
          await activation
        }
        catch {
          // 激活失败已由启动入口处理，此处只保证没有 pending runtime 泄漏。
        }
      }
      const activeRuntime = runtime
      runtime = null
      await activeRuntime?.dispose()
    },
  }
}
