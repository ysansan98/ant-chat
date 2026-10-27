import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopElectronApi,
  createRestrictedIpcRenderer,
  isAllowedEventChannel,
  isAllowedInvokeChannel,
} from '../ipc-security'

function createRawRenderer() {
  return {
    invoke: vi.fn(async (_channel: string, ..._args: unknown[]) => 'ok'),
    on: vi.fn(),
    removeListener: vi.fn(),
  }
}

describe('preload ipc whitelist', () => {
  it('放行已声明的 invoke channel 并透传参数', async () => {
    const raw = createRawRenderer()
    const ipcRenderer = createRestrictedIpcRenderer(raw)

    await expect(ipcRenderer.invoke('runtime.call', 'settings.getSettings', undefined)).resolves.toBe('ok')
    expect(raw.invoke).toHaveBeenCalledWith('runtime.call', 'settings.getSettings', undefined)
  })

  it('拒绝未声明的 invoke channel，且不触碰底层 ipcRenderer', async () => {
    const raw = createRawRenderer()
    const ipcRenderer = createRestrictedIpcRenderer(raw)

    await expect(ipcRenderer.invoke('app.execShell', 'rm -rf /')).rejects.toThrow(
      'preload 拒绝未授权的 IPC 调用: app.execShell',
    )
    expect(raw.invoke).not.toHaveBeenCalled()
  })

  it('拒绝原型链和空 channel', async () => {
    const ipcRenderer = createRestrictedIpcRenderer(createRawRenderer())

    await expect(ipcRenderer.invoke('__proto__', {})).rejects.toThrow('preload 拒绝未授权的 IPC 调用')
    await expect(ipcRenderer.invoke('', {})).rejects.toThrow('preload 拒绝未授权的 IPC 调用')
  })

  it('事件白名单只放行声明过的事件 channel', () => {
    const raw = createRawRenderer()
    const ipcRenderer = createRestrictedIpcRenderer(raw)
    const listener = vi.fn()

    ipcRenderer.on('agent:task-updated', listener)
    ipcRenderer.removeListener('agent:task-updated', listener)

    expect(raw.on).toHaveBeenCalledWith('agent:task-updated', listener)
    expect(raw.removeListener).toHaveBeenCalledWith('agent:task-updated', listener)
    expect(isAllowedEventChannel('agent:task-updated')).toBe(true)
    expect(isAllowedEventChannel('app:navigate')).toBe(true)
    expect(isAllowedEventChannel('arbitrary:event')).toBe(false)
    expect(() => ipcRenderer.on('arbitrary:event', listener)).toThrow(
      'preload 拒绝未授权的 IPC 事件: arbitrary:event',
    )
    expect(() => ipcRenderer.removeListener('arbitrary:event', listener)).toThrow(
      'preload 拒绝未授权的 IPC 事件: arbitrary:event',
    )
    expect(raw.on).toHaveBeenCalledTimes(1)
    expect(raw.removeListener).toHaveBeenCalledTimes(1)
  })

  it('invoke 白名单与事件白名单互不相通', () => {
    expect(isAllowedInvokeChannel('app.clipboardWrite')).toBe(true)
    expect(isAllowedInvokeChannel('agent:task-updated')).toBe(false)
    expect(isAllowedEventChannel('app.clipboardWrite')).toBe(false)
  })

  it('只暴露 invoke、on、removeListener 和 process.platform', () => {
    const api = createDesktopElectronApi(createRawRenderer())

    expect(Object.keys(api.ipcRenderer).sort()).toEqual(['invoke', 'on', 'removeListener'])
    expect(Object.keys(api).sort()).toEqual(['ipcRenderer', 'process'])
    expect(api.process.platform).toBe(process.platform)
    expect(api.ipcRenderer).not.toHaveProperty('send')
    expect(api.ipcRenderer).not.toHaveProperty('once')
    expect(api.ipcRenderer).not.toHaveProperty('off')
  })
})
