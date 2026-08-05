import type { OAuthCallbackHandler, OAuthCallbackHost } from '@ant-chat/backend'
import type { IncomingMessage, RequestListener, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createServer } from 'node:http'
import { logger } from '@main/utils/logger'
import { shell } from 'electron'

export interface OAuthCallbackServer {
  host: OAuthCallbackHost
  dispose: () => Promise<void>
}

/** OpenAI Codex OAuth client 注册的回调端口：1455 为主、1457 为备用（与官方 codex CLI 一致）。 */
const CODEX_CALLBACK_PORTS = [1455, 1457]
const CODEX_CALLBACK_PATH = '/auth/callback'
const CODEX_INTEGRATION_ID = 'codex-subscription'
const GENERIC_CALLBACK_PATH = '/callback'

/**
 * 在 Runtime 激活前建立回调端点。它只负责 HTTP 边界；state 匹配和 token
 * 交换属于 Runtime 内的 OAuth coordinator，避免 Desktop 反向依赖 MCP Module。
 *
 * 通用回调使用随机端口（MCP 等不约束回调地址的 OAuth）；Codex 订阅必须回
 * 调到 OpenAI 注册的固定端口 + `/auth/callback`，否则 authorize 端点在校验
 * 阶段就拒绝请求，因此为它惰性启动一个专用端点，只在首次 Codex 登录时占用
 * 固定端口，避免常驻阻塞 Codex CLI 等同样使用 1455 的工具。
 */
export async function startOAuthCallbackServer(
  openAuthorization: (url: string) => Promise<void> = url => shell.openExternal(url),
): Promise<OAuthCallbackServer> {
  const callbackHandlers = new Set<OAuthCallbackHandler>()
  const servers: Server[] = []

  /** 将回调参数依次交给各 owner，有 owner 处理即停止分发。 */
  async function dispatch(searchParams: URLSearchParams): Promise<boolean> {
    for (const handler of callbackHandlers) {
      const result = await handler(searchParams)
      if (result !== false) {
        return true
      }
    }
    return false
  }

  function createRequestHandler(expectedPath: string) {
    return async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== expectedPath) {
        res.writeHead(404)
        res.end()
        return
      }

      if (callbackHandlers.size === 0) {
        // Runtime 尚未完成激活时不能丢弃 OAuth callback，也不能猜测其归属。
        res.writeHead(503, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body><h3>应用尚未就绪</h3><p>请返回应用后重新开始授权。</p></body></html>')
        return
      }

      try {
        const handled = await dispatch(url.searchParams)
        if (!handled) {
          throw new Error('OAuth 回调不存在、已过期或已被处理。')
        }
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body><h3>授权完成</h3><p>请返回应用查看结果。</p><script>setTimeout(()=>window.close(),2000)</script></body></html>')
      }
      catch (error) {
        logger.error('OAuth callback error:', error)
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end('<html><body><h3>授权处理失败</h3><p>请返回应用后重试。</p></body></html>')
      }
    }
  }

  const genericServer = createServer(createRequestHandler(GENERIC_CALLBACK_PATH))
  await listen(genericServer, 0, '127.0.0.1')
  servers.push(genericServer)
  const genericRedirectUrl = `http://localhost:${(genericServer.address() as AddressInfo).port}${GENERIC_CALLBACK_PATH}`

  let codexRedirectUrl: string | undefined
  const ensureCodexServer = async (): Promise<string> => {
    if (codexRedirectUrl) {
      return codexRedirectUrl
    }
    const codexServer = await bindCodexCallbackServer(createRequestHandler(CODEX_CALLBACK_PATH))
    servers.push(codexServer)
    codexRedirectUrl = `http://localhost:${(codexServer.address() as AddressInfo).port}${CODEX_CALLBACK_PATH}`
    logger.info(`Codex OAuth callback server started at ${codexRedirectUrl}`)
    return codexRedirectUrl
  }

  logger.info(`OAuth callback server started at ${genericRedirectUrl}`)

  return {
    host: {
      redirectUrl: genericRedirectUrl,
      async resolveOAuthRedirectUrl(integrationId) {
        return integrationId === CODEX_INTEGRATION_ID
          ? await ensureCodexServer()
          : genericRedirectUrl
      },
      openAuthorization,
      subscribeCallback(handler) {
        callbackHandlers.add(handler)
        return () => callbackHandlers.delete(handler)
      },
    },
    dispose: async () => {
      callbackHandlers.clear()
      await Promise.all(servers.splice(0).map(closeServer))
    },
  }
}

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function bindCodexCallbackServer(requestHandler: RequestListener): Promise<Server> {
  for (const port of CODEX_CALLBACK_PORTS) {
    const server = createServer(requestHandler)
    try {
      await listen(server, port, '127.0.0.1')
      return server
    }
    catch (error) {
      server.close()
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') {
        throw error
      }
    }
  }
  throw new Error(`Codex OAuth 回调端口 ${CODEX_CALLBACK_PORTS.join('/')} 均被占用。请先关闭占用这些端口的进程（如 Codex CLI / CLIProxyAPI）后重试。`)
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
  })
}
