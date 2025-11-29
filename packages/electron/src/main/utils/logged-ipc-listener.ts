import type { ExtractHandler, IpcEventMap } from '@electron-toolkit/typed-ipc/main'
import { IpcListener } from '@electron-toolkit/typed-ipc/main'
import { logger } from './logger'

export class LoggedIpcListener<T extends IpcEventMap> extends IpcListener<T> {
  /**
   * TODO 可能有BUG
   */
  handle<E extends keyof ExtractHandler<T>>(
    channel: Extract<E, string>,
    listener: (
      e: Electron.IpcMainInvokeEvent,
      ...args: Parameters<ExtractHandler<T>[E]>
    ) => ReturnType<ExtractHandler<T>[E]> | Promise<ReturnType<ExtractHandler<T>[E]>>,
  ): void {
    const handle: (
      e: Electron.IpcMainInvokeEvent,
      ...args: Parameters<ExtractHandler<T>[E]>
    ) => ReturnType<ExtractHandler<T>[E]> | Promise<ReturnType<ExtractHandler<T>[E]>> = async (e, ...args) => {
      logger.debug(`[IPC] Receiving event: [${String(channel)}] `, ...args)
      try {
        const result = await listener(e, ...args)
        logger.debug(`[IPC] Finished handling event: ${String(channel)}. result: `, result)
        return result
      }
      catch (error) {
        logger.error(`[IPC] Error handling event: ${String(channel)}`, error)
        throw error
      }
    }
    super.handle(channel, handle)
  }
}
