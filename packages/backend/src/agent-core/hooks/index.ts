import type { AgentCommandHost, ILogger } from '@ant-chat/shared'
import type { HookCommandExecutor } from './hookRunner'
import type { IHookDispatcher } from './types'
import { HookConfigStore } from './hookConfigStore'
import { createHookDispatcher } from './hookDispatcher'
import { createCommandHostHookExecutor, createHookRunner } from './hookRunner'

export * from './hookConfigStore'
export * from './hookDispatcher'
export * from './hookRunner'
export * from './types'

export interface CreateHookSystemOptions {
  /** 全局 hooks 文件（~/.ant-chat/hooks.json）。 */
  globalFilePath: string
  commandHost: AgentCommandHost
  logger?: ILogger
  /** 测试注入；缺省使用命令宿主执行器。 */
  executor?: HookCommandExecutor
}

export interface HookSystem {
  store: HookConfigStore
  dispatcher: IHookDispatcher
}

export function createHookSystem(options: CreateHookSystemOptions): HookSystem {
  const store = new HookConfigStore({ globalFilePath: options.globalFilePath, logger: options.logger })
  const executor = options.executor ?? createCommandHostHookExecutor(options.commandHost)
  const runner = createHookRunner({ executor, logger: options.logger })
  const dispatcher = createHookDispatcher({ store, runner, logger: options.logger })
  return { store, dispatcher }
}
