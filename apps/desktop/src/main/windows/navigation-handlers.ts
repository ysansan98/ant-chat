import type { WebContents } from 'electron'
import type { AppNavigationContext } from './navigation-policy'
import { isAllowedAppNavigation, resolveExternalUrl, shouldAllowWindowOpen } from './navigation-policy'

type NavigationWebContents = Pick<WebContents, 'on' | 'setWindowOpenHandler'>

export interface NavigationHandlerOptions {
  context: AppNavigationContext
  /** 交给系统浏览器打开；由调用方注入以便测试时不真正启动浏览器 */
  openExternal: (url: string) => Promise<void> | void
  onExternalOpenError?: (error: unknown) => void
  log?: (message: string, ...args: unknown[]) => void
}

/**
 * 为窗口安装导航与新窗口策略：
 * - 应用自身页面放行；
 * - http/https 外部链接拦截后交给系统浏览器；
 * - file 与自定义协议只拦截、不打开；
 * - 任何新窗口一律 deny。
 */
export function setupNavigationHandlers(webContents: NavigationWebContents, options: NavigationHandlerOptions): void {
  const { context, openExternal } = options

  const openInSystemBrowser = (rawUrl: string) => {
    const externalUrl = resolveExternalUrl(rawUrl)
    if (!externalUrl)
      return
    try {
      void Promise.resolve(openExternal(externalUrl)).catch((error) => {
        options.onExternalOpenError?.(error)
      })
    }
    catch (error) {
      options.onExternalOpenError?.(error)
    }
  }

  webContents.on('will-navigate', (event, url) => {
    options.log?.('will-navigate', url)

    if (isAllowedAppNavigation(url, context))
      return

    event.preventDefault()
    openInSystemBrowser(url)
  })

  webContents.setWindowOpenHandler(({ url }) => {
    options.log?.('setWindowOpenHandler', url)

    // 当前策略下始终为 false；保留分支表达「默认拒绝、仅在显式允许时才新建窗口」
    if (shouldAllowWindowOpen(url))
      return { action: 'allow' }

    openInSystemBrowser(url)
    return { action: 'deny' }
  })
}
