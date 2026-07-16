import { describe, expect, it, vi } from 'vitest'
import { createRuntimeActivation } from '../runtimeActivation'

describe('runtime activation', () => {
  it('单实例锁冲突时不初始化业务模块或开放控制端点', async () => {
    const conflict = Object.assign(new Error('runtime already active'), { code: 'EADDRINUSE' })
    const lifecycle = { initialize: vi.fn(), dispose: vi.fn() }
    const controlEndpoint = {
      reserve: vi.fn(() => { throw conflict }),
      start: vi.fn(),
      stopListening: vi.fn(),
      releaseReservation: vi.fn(),
    }
    const activation = createRuntimeActivation(lifecycle, controlEndpoint)

    await expect(activation.activate()).rejects.toBe(conflict)

    expect(lifecycle.initialize).not.toHaveBeenCalled()
    expect(controlEndpoint.start).not.toHaveBeenCalled()
  })

  it('控制端点启动失败时按端点、业务模块、锁逆序释放并保留原错误', async () => {
    const calls: string[] = []
    const endpointError = new Error('endpoint failed')
    const activation = createRuntimeActivation({
      initialize: async () => { calls.push('initialize:modules') },
      dispose: async () => { calls.push('dispose:modules') },
    }, {
      reserve: () => calls.push('reserve:lock'),
      start: async () => {
        calls.push('start:endpoint')
        throw endpointError
      },
      stopListening: async () => { calls.push('stop:endpoint') },
      releaseReservation: () => calls.push('release:lock'),
    })

    await expect(activation.activate()).rejects.toBe(endpointError)

    expect(calls).toEqual([
      'reserve:lock',
      'initialize:modules',
      'start:endpoint',
      'stop:endpoint',
      'dispose:modules',
      'release:lock',
    ])
  })
})
