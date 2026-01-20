import { nanoid } from 'nanoid'
import { emitter } from './ipc-bus'

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
  return await emitter.invoke('common:clipboard-write', data)
}

export function getSystemPlatform() {
  return window.electron.process.platform as 'linux' | 'darwin' | 'win32'
}

export function minimizeWindow() {
  emitter.send('common:minimize-window')
}

export function maximizeOrRestoreWindow() {
  emitter.send('common:maximize-or-resore-window')
}

export function quitApp() {
  emitter.send('common:quit-app')
}
