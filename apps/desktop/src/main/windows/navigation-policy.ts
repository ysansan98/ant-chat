import { pathToFileURL } from 'node:url'

/**
 * 主窗口允许停留的页面范围。
 *
 * 开发环境只允许 dev server 的同源页面；生产环境只允许应用自身的
 * `renderer/index.html`（可带 hash/query）。其余一律拒绝，避免渲染层被攻陷后
 * 把主窗口导航到本地文件或自定义协议页面（preload 仍会注入）。
 */
export interface AppNavigationContext {
  /** 是否开发环境（与窗口选择加载方式的判断保持一致） */
  isDev: boolean
  /** dev server 地址；未配置时回退到生产文件加载 */
  rendererUrl?: string | null
  /** 生产环境 index.html 的绝对路径；应与 loadFile 使用的路径一致 */
  appIndexPath?: string | null
}

function parseUrl(rawUrl: string): null | URL {
  try {
    return new URL(rawUrl)
  }
  catch {
    return null
  }
}

function parseHttpUrl(rawUrl: string): null | URL {
  const url = parseUrl(rawUrl)
  if (!url || (url.protocol !== 'http:' && url.protocol !== 'https:'))
    return null
  // 带凭据的 URL 会让来源判断变得含糊（origin 会忽略 username/password），一律拒绝
  if (url.username || url.password)
    return null
  return url
}

/** 是否允许在主窗口内导航到该 URL。默认拒绝，只放行应用自身页面。 */
export function isAllowedAppNavigation(rawUrl: string, context: AppNavigationContext): boolean {
  const url = parseUrl(rawUrl)
  if (!url || url.username || url.password)
    return false

  if (context.isDev && context.rendererUrl) {
    const devUrl = parseHttpUrl(context.rendererUrl)
    if (!devUrl)
      return false
    return url.origin === devUrl.origin
  }

  if (!context.appIndexPath)
    return false
  if (url.protocol !== 'file:' || url.host !== '')
    return false

  // 用 URL 规范化后的 pathname 做全等比较：
  // - `index.html.evil`、`index.html/../secret` 等前缀/穿越写法都会被拒绝
  // - hash/query 不参与比较，允许应用内路由跳转
  return url.pathname === pathToFileURL(context.appIndexPath).pathname
}

/**
 * 解析可用于外部浏览器打开的 URL。
 * 仅接受 http/https；file、自定义协议、javascript 等一律返回 null。
 */
export function resolveExternalUrl(rawUrl: string): null | string {
  return parseHttpUrl(rawUrl)?.href ?? null
}

/**
 * 是否允许新建应用内窗口。
 * 默认拒绝：新窗口策略是「外部链接交给系统浏览器，其余全部拦截」。
 */
export function shouldAllowWindowOpen(_rawUrl: string): boolean {
  return false
}
