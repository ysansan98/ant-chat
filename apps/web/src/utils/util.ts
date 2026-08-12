import { writeClipboardText } from '@workspace/ui/lib/clipboard'
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

export async function clipboardWrite(data: { text?: string }): Promise<void> {
  if (__APP_RUNTIME__ === 'electron') {
    await ipc.app.clipboardWrite(data as Electron.Data)
    return
  }

  await writeClipboardText(data.text ?? '')
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

/** 从 unknown 类型的错误中提取可读消息 */
export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * 从 localStorage 读取一个数值，校验并 clamp 到 [min, max] 范围。
 * 不可用或无效时返回 fallback。
 */
export function loadClampedNumber(key: string, min: number, max: number | undefined, fallback: number): number {
  try {
    const raw = window.localStorage.getItem(key)
    const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
    if (!Number.isFinite(parsed)) {
      return fallback
    }
    const clamped = Math.max(min, parsed)
    return max !== undefined ? Math.min(max, clamped) : clamped
  }
  catch {
    return fallback
  }
}
