import type { AppRpcInput, CommandHostStatus } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { Method, Module } from '../../decorators'

/** 只读暴露启动事实；不返回 Command Host 的受控环境。 */
@Module('runtime')
export class RuntimeStatusModule implements RuntimeModuleMethods<'runtime'> {
  constructor(private readonly core: Pick<RuntimeCore, 'commandHost'>) {}

  @Method()
  getCommandHostStatus(_input?: AppRpcInput<'runtime.getCommandHostStatus'>): CommandHostStatus {
    const host = this.core.commandHost
    if (host.status === 'unavailable') {
      return {
        status: 'unavailable',
        platform: host.platform,
        candidates: [...host.candidates],
        reason: host.reason,
      }
    }
    if (host.platform === 'posix') {
      return {
        status: 'available',
        platform: host.platform,
        interpreter: host.interpreter,
        executablePath: host.executablePath,
      }
    }
    return {
      status: 'available',
      platform: host.platform,
      interpreter: host.interpreter,
      executablePath: host.executablePath,
    }
  }
}
