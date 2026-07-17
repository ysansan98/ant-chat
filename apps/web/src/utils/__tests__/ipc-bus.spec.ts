import { describe, expect, it, vi } from 'vitest'

describe('ipc-bus browser fallback', () => {
  it('throws for non-event IPC access outside Electron', async () => {
    vi.resetModules()
    window.electron = undefined as unknown as Window['electron']

    const { getIpc, isElectronRuntime } = await import('../ipc-bus')

    expect(isElectronRuntime()).toBe(false)
    expect(() => getIpc()).toThrow('Electron IPC is not available in this runtime')
  })
})
