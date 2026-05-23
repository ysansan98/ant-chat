import { nanoid } from 'nanoid'
import { ipc } from './ipc-bus'

export function debounce<T extends (...args: any[]) => void>(func: T, delay: number): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>

  return function (...args: Parameters<T>) {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
    timeoutId = setTimeout(() => {
      func(...args)
    }, delay)
  }
}

export function uuid(prefix?: string) {
  return `${prefix || ''}${nanoid()}`
}

export async function clipboardWrite(data: Electron.Data) {
  return await ipc.app.clipboardWrite(data)
}

export function getSystemPlatform() {
  return window.electron.process.platform as 'linux' | 'darwin' | 'win32'
}

export function minimizeWindow() {
  void ipc.app.minimizeWindow()
}

export function maximizeOrRestoreWindow() {
  void ipc.app.maximizeOrRestoreWindow()
}

export function quitApp() {
  void ipc.app.quitApp()
}
