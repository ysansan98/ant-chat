import { describe, expect, it, vi } from 'vitest'

describe('ipc-bus browser fallback', () => {
  it('keeps event listener APIs as no-ops outside Electron', async () => {
    vi.resetModules()
    window.electron = undefined as unknown as Window['electron']

    const { ipcRenderer, isElectronRuntime } = await import('../ipc-bus')

    expect(isElectronRuntime()).toBe(false)
    expect(ipcRenderer.on('provider:changed', () => undefined)).toBeUndefined()
    expect(ipcRenderer.removeListener('provider:changed', () => undefined)).toBeUndefined()
    expect(ipcRenderer.removeAllListeners('provider:changed')).toBeUndefined()
  })

  it('throws for non-event IPC access outside Electron', async () => {
    vi.resetModules()
    window.electron = undefined as unknown as Window['electron']

    const { ipcRenderer } = await import('../ipc-bus')

    expect(() => ipcRenderer.invoke('settings:get')).toThrow('Electron IPC renderer is not available in this runtime')
  })
})
