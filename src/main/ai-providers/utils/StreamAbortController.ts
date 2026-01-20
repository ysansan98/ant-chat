import { mainEmitter } from '@main/utils/ipc-events-bus'
import { getMainWindow } from '@main/window'

const streamAbortControllerMapping = new Map<string, StreamAbortController>()

export class StreamAbortController extends AbortController {
  private conversationsId: string

  constructor(conversationsId: string) {
    super()
    this.conversationsId = conversationsId
    streamAbortControllerMapping.set(conversationsId, this)
  }

  abort(reason?: any): void {
    // 先发送取消消息
    const mainWindow = getMainWindow()
    if (!mainWindow) {
      super.abort(reason)
      throw new Error('not found mainWindow')
    }
    mainEmitter.send(mainWindow.webContents, 'chat:stream-canceled', this.conversationsId)
    streamAbortControllerMapping.delete(this.conversationsId)
    // 再调用父类 abort
    super.abort(reason)
  }

  static abortConversationsStream(conversationsId: string) {
    const controller = streamAbortControllerMapping.get(conversationsId)
    if (controller) {
      controller.abort('用户已主动取消')
    }
  }
}
