import type { OAuthCallbackHandler, OAuthCallbackHost } from '@ant-chat/backend'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { logger } from '@main/utils/logger'
import { shell } from 'electron'

export interface OAuthCallbackServer {
  host: OAuthCallbackHost
  dispose: () => Promise<void>
}

/**
 * 在 Runtime 激活前建立回调端点。它只负责 HTTP 边界；state 匹配和 token
 * 交换属于 Runtime 内的 OAuth coordinator，避免 Desktop 反向依赖 MCP Module。
 */
export async function startOAuthCallbackServer(
  openAuthorization: (url: string) => Promise<void> = url => shell.openExternal(url),
): Promise<OAuthCallbackServer> {
  let callbackHandler: OAuthCallbackHandler | undefined
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/callback') {
      res.writeHead(404)
      res.end()
      return
    }

    const handler = callbackHandler
    if (!handler) {
      // Runtime 尚未完成激活时不能丢弃 OAuth callback，也不能猜测其归属。
      res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><h3>应用尚未就绪</h3><p>请返回应用后重新开始授权。</p></body></html>')
      return
    }

    try {
      await handler(url.searchParams)
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><h3>授权完成</h3><p>请返回应用查看结果。</p><script>setTimeout(()=>window.close(),2000)</script></body></html>')
    }
    catch (error) {
      logger.error('OAuth callback error:', error)
      res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<html><body><h3>授权处理失败</h3><p>请返回应用后重试。</p></body></html>')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address() as AddressInfo
  const redirectUrl = `http://localhost:${address.port}/callback`
  logger.info(`OAuth callback server started at ${redirectUrl}`)

  return {
    host: {
      redirectUrl,
      openAuthorization,
      setCallbackHandler(handler) {
        callbackHandler = handler
      },
    },
    dispose: async () => {
      callbackHandler = undefined
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(error) : resolve())
      })
    },
  }
}
