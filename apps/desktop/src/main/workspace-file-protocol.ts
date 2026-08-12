import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { getAppRuntime } from './app-runtime-host/appRuntime'
import { logger } from './utils/logger'

/** 自定义 scheme：工作区文件流式预览（图片/音视频/Excel）。 */
const SCHEME = 'antchat-ws-file'

/**
 * app ready 前注册：声明 scheme 特权。
 * standard+secure 让 renderer 可直接作为 <img>/<video>/<audio> src 使用；
 * supportFetchAPI+stream 支持 fetch 与流式响应（含 Range）。
 * 必须在 app ready 之前调用一次。
 */
export function registerWorkspaceFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
      },
    },
  ])
}

/**
 * app ready 后注册：拦截 antchat-ws-file 请求，
 * 通过 RPC 复用工作区路径安全校验，再用 net.fetch 读取本地文件（自动支持 Range）。
 * URL 形如 antchat-ws-file://file?workspacePath=...&relPath=...
 */
export function registerWorkspaceFileProtocol(): void {
  protocol.handle(SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      const workspacePath = url.searchParams.get('workspacePath') ?? ''
      const relPath = url.searchParams.get('relPath') ?? ''
      if (!workspacePath || !relPath) {
        return new Response('workspacePath 与 relPath 不能为空', {
          status: 400,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        })
      }

      // 安全校验由后端 workspace.resolveFileForStream 统一完成（防遍历/符号链接逃逸）
      const info = await getAppRuntime().invoke('workspace.resolveFileForStream', { workspacePath, relPath })
      // net.fetch 读取 file:// URL，自动处理 Range 请求与 content-type
      return net.fetch(pathToFileURL(info.absolutePath).toString())
    }
    catch (error) {
      logger.error('工作区文件流式预览失败', error)
      const message = error instanceof Error ? error.message : String(error)
      return new Response(message, {
        status: 403,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      })
    }
  })
}
