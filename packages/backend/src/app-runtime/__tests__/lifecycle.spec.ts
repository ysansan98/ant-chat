import type { RuntimeModule } from '../runtimeModule'
import { describe, expect, it, vi } from 'vitest'
import { createRuntimeLifecycle } from '../lifecycle'

describe('runtime lifecycle', () => {
  it('初始化失败时只逆序释放已经激活的模块和 core 资源', async () => {
    const calls: string[] = []
    const initializedModule: RuntimeModule = {
      initialize: () => { calls.push('initialize:first') },
      dispose: () => { calls.push('dispose:first') },
    }
    const failedModule: RuntimeModule = {
      initialize: () => {
        calls.push('initialize:failed')
        throw new Error('module activation failed')
      },
      dispose: () => { calls.push('dispose:failed') },
    }
    const skippedModule: RuntimeModule = {
      initialize: () => { calls.push('initialize:skipped') },
      dispose: () => { calls.push('dispose:skipped') },
    }
    const lifecycle = createRuntimeLifecycle({
      db: { close: () => calls.push('close:db') },
      events: { clear: () => calls.push('clear:events') },
    } as never, [initializedModule, failedModule, skippedModule])

    await expect(lifecycle.initialize()).rejects.toThrow('module activation failed')

    expect(calls).toEqual([
      'initialize:first',
      'initialize:failed',
      'dispose:failed',
      'dispose:first',
      'clear:events',
      'close:db',
    ])
    await lifecycle.dispose()
    expect(calls).toHaveLength(6)
  })

  it('释放失败不会阻止其他模块与 core 逆序释放', async () => {
    const calls: string[] = []
    const lifecycle = createRuntimeLifecycle({
      db: { close: () => calls.push('close:db') },
      events: { clear: () => calls.push('clear:events') },
    } as never, [
      { initialize: vi.fn(), dispose: () => { calls.push('dispose:first') } },
      {
        initialize: vi.fn(),
        dispose: () => {
          calls.push('dispose:second')
          throw new Error('dispose failed')
        },
      },
    ])
    await lifecycle.initialize()

    await expect(lifecycle.dispose()).rejects.toThrow('dispose failed')

    expect(calls).toEqual(['dispose:second', 'dispose:first', 'clear:events', 'close:db'])
  })
})
