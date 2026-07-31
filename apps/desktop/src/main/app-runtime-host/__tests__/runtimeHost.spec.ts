import { describe, expect, it, vi } from 'vitest'
import { createRuntimeHost } from '../runtimeHost'

describe('runtime host', () => {
  it('并发激活只创建一次，并且激活完成前不发布 Runtime', async () => {
    let resolveActivation!: (runtime: { dispose: () => Promise<void> }) => void
    const activate = vi.fn(() => new Promise<{ dispose: () => Promise<void> }>((resolve) => {
      resolveActivation = resolve
    }))
    const host = createRuntimeHost(activate, vi.fn())

    const first = host.activate()
    const second = host.activate()
    expect(() => host.get()).toThrow('尚未完成激活')
    expect(activate).toHaveBeenCalledOnce()

    const runtime = { dispose: vi.fn(async () => {}) }
    resolveActivation(runtime)
    await expect(first).resolves.toBe(runtime)
    await expect(second).resolves.toBe(runtime)
    expect(host.get()).toBe(runtime)
  })

  it('退出发生在激活期间时等待激活完成后立即释放 Runtime', async () => {
    let resolveActivation!: (runtime: { dispose: () => Promise<void> }) => void
    const runtime = { dispose: vi.fn(async () => {}) }
    const host = createRuntimeHost(
      () => new Promise((resolve) => { resolveActivation = resolve }),
      vi.fn(),
    )

    void host.activate()
    const disposing = host.dispose()
    expect(runtime.dispose).not.toHaveBeenCalled()

    resolveActivation(runtime)
    await disposing

    expect(runtime.dispose).toHaveBeenCalledOnce()
    expect(() => host.get()).toThrow('尚未完成激活')
  })

  it('dispose 开始后 isShuttingDown 为 true，用于区分尚未激活与正在关闭', async () => {
    const host = createRuntimeHost(async () => ({ dispose: vi.fn(async () => {}) }), vi.fn())
    expect(host.isShuttingDown()).toBe(false)

    const disposing = host.dispose()
    expect(host.isShuttingDown()).toBe(true)
    await disposing
    expect(host.isShuttingDown()).toBe(true)
  })
})
