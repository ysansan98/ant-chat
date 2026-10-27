import { describe, expect, it } from 'vitest'
import {
  isAllowedAppNavigation,
  resolveExternalUrl,
  shouldAllowWindowOpen,
} from '../navigation-policy'

const APP_INDEX_PATH = '/app/out/renderer/index.html'
const APP_INDEX_URL = 'file:///app/out/renderer/index.html'

const prodContext = { isDev: false, appIndexPath: APP_INDEX_PATH }
const devContext = {
  isDev: true,
  rendererUrl: 'http://localhost:5173',
  appIndexPath: APP_INDEX_PATH,
}

describe('isAllowedAppNavigation：开发环境', () => {
  it('允许 dev server 同源页面（含 hash/query/子路径）', () => {
    expect(isAllowedAppNavigation('http://localhost:5173/', devContext)).toBe(true)
    expect(isAllowedAppNavigation('http://localhost:5173/#/settings', devContext)).toBe(true)
    expect(isAllowedAppNavigation('http://localhost:5173/?foo=bar#/chat', devContext)).toBe(true)
    expect(isAllowedAppNavigation('http://localhost:5173/src/main.tsx', devContext)).toBe(true)
  })

  it('拒绝不同端口、不同协议与伪造主机', () => {
    expect(isAllowedAppNavigation('http://localhost:51730/', devContext)).toBe(false)
    expect(isAllowedAppNavigation('https://localhost:5173/', devContext)).toBe(false)
    expect(isAllowedAppNavigation('http://127.0.0.1:5173/', devContext)).toBe(false)
    expect(isAllowedAppNavigation('http://localhost:5173.evil.com/', devContext)).toBe(false)
    expect(isAllowedAppNavigation('http://localhost:5173@evil.com/', devContext)).toBe(false)
  })

  it('拒绝 file、自定义协议与带凭据的 URL', () => {
    expect(isAllowedAppNavigation(APP_INDEX_URL, devContext)).toBe(false)
    expect(isAllowedAppNavigation('antchat-ws-file://file?x=1', devContext)).toBe(false)
    expect(isAllowedAppNavigation('javascript:alert(1)', devContext)).toBe(false)
    expect(isAllowedAppNavigation('http://user:pass@localhost:5173/', devContext)).toBe(false)
  })

  it('dev 未配置 rendererUrl 时回退到生产 index.html', () => {
    const context = { isDev: true, rendererUrl: null, appIndexPath: APP_INDEX_PATH }
    expect(isAllowedAppNavigation(APP_INDEX_URL, context)).toBe(true)
    expect(isAllowedAppNavigation('http://localhost:5173/', context)).toBe(false)
  })

  it('rendererUrl 非 http/https 时拒绝所有页面', () => {
    const context = { isDev: true, rendererUrl: 'file:///tmp/dev', appIndexPath: APP_INDEX_PATH }
    expect(isAllowedAppNavigation(APP_INDEX_URL, context)).toBe(false)
    expect(isAllowedAppNavigation('file:///tmp/dev', context)).toBe(false)
  })
})

describe('isAllowedAppNavigation：生产环境', () => {
  it('允许应用自身 index.html（含 hash/query）', () => {
    expect(isAllowedAppNavigation(APP_INDEX_URL, prodContext)).toBe(true)
    expect(isAllowedAppNavigation(`${APP_INDEX_URL}#/settings`, prodContext)).toBe(true)
    expect(isAllowedAppNavigation(`${APP_INDEX_URL}?v=1#/chat`, prodContext)).toBe(true)
  })

  it('拒绝前缀相似与路径穿越写法', () => {
    expect(isAllowedAppNavigation('file:///app/out/renderer/index.html.evil', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('file:///app/out/renderer/index.html/../secret', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('file:///app/out/renderer/index.html/child', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('file:///app/out/renderer/index.html%2F..%2Fsecret', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('file:///app/out/renderer/index.htm', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('file:///app/out/renderer/INDEX.HTML', prodContext)).toBe(false)
  })

  it('拒绝其他本地文件、远程地址与自定义协议', () => {
    expect(isAllowedAppNavigation('file:///etc/passwd', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('file:///app/out/renderer/other.html', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('file://evil.com/app/out/renderer/index.html', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('https://example.com/index.html', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('antchat-ws-file://file?workspacePath=/tmp', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('about:blank', prodContext)).toBe(false)
  })

  it('缺少 appIndexPath 或 URL 非法时拒绝', () => {
    expect(isAllowedAppNavigation(APP_INDEX_URL, { isDev: false })).toBe(false)
    expect(isAllowedAppNavigation('not a url', prodContext)).toBe(false)
    expect(isAllowedAppNavigation('', prodContext)).toBe(false)
  })

  it('生产环境即使配置了 rendererUrl 也不放行 dev server', () => {
    const context = { isDev: false, rendererUrl: 'http://localhost:5173', appIndexPath: APP_INDEX_PATH }
    expect(isAllowedAppNavigation('http://localhost:5173/', context)).toBe(false)
    expect(isAllowedAppNavigation(APP_INDEX_URL, context)).toBe(true)
  })
})

describe('resolveExternalUrl', () => {
  it('仅接受 http/https 并返回规范化 URL', () => {
    expect(resolveExternalUrl('https://example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c')
    expect(resolveExternalUrl('http://example.com')).toBe('http://example.com/')
  })

  it('拒绝 file、自定义协议、javascript 与带凭据 URL', () => {
    expect(resolveExternalUrl('file:///etc/passwd')).toBeNull()
    expect(resolveExternalUrl('antchat-ws-file://file?x=1')).toBeNull()
    expect(resolveExternalUrl('javascript:alert(1)')).toBeNull()
    expect(resolveExternalUrl('data:text/html,hi')).toBeNull()
    expect(resolveExternalUrl('https://user:pass@example.com/')).toBeNull()
    expect(resolveExternalUrl('not a url')).toBeNull()
  })
})

describe('shouldAllowWindowOpen', () => {
  it('默认拒绝所有新窗口', () => {
    expect(shouldAllowWindowOpen('https://example.com/')).toBe(false)
    expect(shouldAllowWindowOpen(APP_INDEX_URL)).toBe(false)
    expect(shouldAllowWindowOpen('antchat-ws-file://file?x=1')).toBe(false)
    expect(shouldAllowWindowOpen('about:blank')).toBe(false)
  })
})
