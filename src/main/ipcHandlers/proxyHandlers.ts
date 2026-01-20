import { createErrorIpcResponse, createIpcResponse } from '@ant-chat/shared'
import { mainListener } from '@main/utils/ipc-events-bus'
import { logger } from '@main/utils/logger'
import { testProxyConnection } from '../utils/system-proxy'

export function registerProxyHandlers() {
  // 测试代理连接
  mainListener.handle('proxy:test-connection', async (_, proxyUrl) => {
    try {
      const success = await testProxyConnection(proxyUrl)
      return createIpcResponse(true, success)
    }
    catch (error) {
      logger.error('Proxy test failed:', error)
      return createErrorIpcResponse(error instanceof Error ? error : String(error))
    }
  })
}
