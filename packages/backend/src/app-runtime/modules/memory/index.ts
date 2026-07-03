import type { AppRpcInput } from '@ant-chat/shared'
import type { RuntimeCore } from '../../createRuntimeCore'
import type { RuntimeModuleMethods } from '../../routeRegistry'
import { Method, Module } from '../../decorators'

@Module('memory')
export class MemoryModule implements RuntimeModuleMethods<'memory'> {
  constructor(private readonly core: Pick<RuntimeCore, 'data'>) {}

  @Method()
  getMemoryFiles(_input: AppRpcInput<'memory.getMemoryFiles'>) {
    return this.core.data.memoryManager.readMemoryFiles()
  }

  @Method()
  updateMemoryFiles(input: AppRpcInput<'memory.updateMemoryFiles'>) {
    return this.core.data.memoryManager.updateMemoryFiles(input.input)
  }

  @Method()
  rollbackSoul(_input: AppRpcInput<'memory.rollbackSoul'>) {
    return this.core.data.memoryManager.rollbackSoul()
  }
}
