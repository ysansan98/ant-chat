import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { setupNavigationHandlers } from '../navigation-handlers'

interface FakeNavigationEvent {
  preventDefault: ReturnType<typeof vi.fn>
}

interface FakeWebContents {
  webContents: WebContents
  navigate: (url: string) => FakeNavigationEvent
  openWindow: (url: string) => { action: string }
  registeredEvents: string[]
}

const APP_INDEX_PATH = '/app/out/renderer/index.html'
const APP_INDEX_URL = 'file:///app/out/renderer/index.html'

function createFakeWebContents(): FakeWebContents {
  let navigateHandler: ((event: FakeNavigationEvent, url: string) => void) | null = null
  let windowOpenHandler: ((details: { url: string }) => { action: string }) | null = null
  const registeredEvents: string[] = []
  let fake: FakeWebContents

  const on = vi.fn((event: string, handler: typeof navigateHandler) => {
    registeredEvents.push(event)
    if (event === 'will-navigate')
      navigateHandler = handler
    return fake.webContents
  })

  const setWindowOpenHandler = vi.fn((handler: typeof windowOpenHandler) => {
    windowOpenHandler = handler
  })

  fake = {
    webContents: { on, setWindowOpenHandler } as unknown as WebContents,
    registeredEvents,
    navigate(url: string) {
      if (!navigateHandler)
        throw new Error('will-navigate handler 未注册')
      const event: FakeNavigationEvent = { preventDefault: vi.fn() }
      navigateHandler(event, url)
      return event
    },
    openWindow(url: string) {
      if (!windowOpenHandler)
        throw new Error('window open handler 未注册')
      return windowOpenHandler({ url })
    },
  }

  return fake
}

function setup(options: { isDev?: boolean, rendererUrl?: string } = {}) {
  const fake = createFakeWebContents()
  const openExternal = vi.fn(async (_url: string) => {})
  const onExternalOpenError = vi.fn()
  setupNavigationHandlers(fake.webContents, {
    context: {
      isDev: options.isDev ?? false,
      rendererUrl: options.rendererUrl ?? null,
      appIndexPath: APP_INDEX_PATH,
    },
    openExternal,
    onExternalOpenError,
  })
  return { ...fake, openExternal, onExternalOpenError }
}

describe('setupNavigationHandlers：will-navigate', () => {
  it('放行应用自身 index.html（含 hash）', () => {
    const { navigate, openExternal } = setup()

    const event = navigate(`${APP_INDEX_URL}#/settings`)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('开发环境放行 dev server 同源导航', () => {
    const { navigate, openExternal } = setup({ isDev: true, rendererUrl: 'http://localhost:5173' })

    const event = navigate('http://localhost:5173/#/chat')

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('外部 http/https 拦截后交给系统浏览器', () => {
    const { navigate, openExternal } = setup()

    const event = navigate('https://example.com/docs?q=1')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/docs?q=1')
  })

  it.each([
    ['其他本地文件', 'file:///etc/passwd'],
    ['自定义协议', 'antchat-ws-file://file?workspacePath=/tmp'],
    ['javascript 协议', 'javascript:alert(1)'],
  ])('%s：只拦截，不打开外部程序', (_label, url) => {
    const { navigate, openExternal } = setup()

    const event = navigate(url)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('openExternal 失败时回调错误且不抛出', async () => {
    const fake = createFakeWebContents()
    const openExternal = vi.fn(async () => {
      throw new Error('no browser')
    })
    const onExternalOpenError = vi.fn()
    setupNavigationHandlers(fake.webContents, {
      context: { isDev: false, appIndexPath: APP_INDEX_PATH },
      openExternal,
      onExternalOpenError,
    })

    expect(() => fake.navigate('https://example.com/')).not.toThrow()
    await vi.waitFor(() => expect(onExternalOpenError).toHaveBeenCalledOnce())
  })
})

describe('setupNavigationHandlers：新窗口', () => {
  it('http/https 新窗口：拒绝并交给系统浏览器', () => {
    const { openWindow, openExternal } = setup()

    expect(openWindow('https://example.com/popup')).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com/popup')
  })

  it.each([
    ['本地文件', 'file:///etc/passwd'],
    ['自定义协议', 'antchat-ws-file://file?x=1'],
    ['about:blank', 'about:blank'],
  ])('%s 新窗口：直接拒绝且不打开', (_label, url) => {
    const { openWindow, openExternal } = setup()

    expect(openWindow(url)).toEqual({ action: 'deny' })
    expect(openExternal).not.toHaveBeenCalled()
  })
})
