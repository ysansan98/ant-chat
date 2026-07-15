import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { visualizationRuntimeSource } from '../runtime/runtimeSource'

function createSandboxDom(body: string) {
  const host = new JSDOM('<!doctype html><html><body><iframe></iframe></body></html>', {
    runScripts: 'dangerously',
    url: 'http://localhost',
  })
  const frameWindow = host.window.document.querySelector('iframe')?.contentWindow
  if (!frameWindow)
    throw new Error('测试 iframe 创建失败')
  frameWindow.document.head.innerHTML = '<style id="ant-chat-viz-theme"></style>'
  frameWindow.document.body.innerHTML = body
  frameWindow.eval(visualizationRuntimeSource)
  return { frameWindow, host }
}

describe('visualization sandbox runtime', () => {
  it('只暴露 follow-up bridge，使用真实 gesture token，并接收主题/resize 消息', () => {
    expect(visualizationRuntimeSource).toContain('window.antChatVisualization')
    expect(visualizationRuntimeSource).toContain('event.isTrusted')
    expect(visualizationRuntimeSource).toContain('type: \'follow-up-request\'')
    expect(visualizationRuntimeSource).toContain('message?.type === \'theme\'')
    expect(visualizationRuntimeSource).toContain('type: \'resize\'')
    expect(visualizationRuntimeSource).toContain('ant-chat-viz-theme')
    expect(visualizationRuntimeSource).not.toContain('root.style.setProperty')
    expect(visualizationRuntimeSource).not.toContain('window.electron')
  })

  it('点击提交按钮时阻止原生导航，并继续执行 fragment submit handler', () => {
    const { frameWindow, host } = createSandboxDom('<form><button type="submit">提交</button></form>')
    const form = frameWindow.document.querySelector('form')
    const button = frameWindow.document.querySelector('button')
    const observed = { submitEvent: null as SubmitEvent | null }
    form?.addEventListener('submit', (event) => {
      observed.submitEvent = event as SubmitEvent
    })

    button?.click()

    expect(observed.submitEvent?.defaultPrevented).toBe(true)
    expect(observed.submitEvent?.submitter).toBe(button)
    host.window.close()
  })

  it('form.submit 不会绕过 sandbox 表单拦截', () => {
    const { frameWindow, host } = createSandboxDom('<form><button type="submit">提交</button></form>')
    const form = frameWindow.document.querySelector('form')
    const observed = { submitEvent: null as Event | null }
    form?.addEventListener('submit', (event) => {
      observed.submitEvent = event
    })

    form?.submit()

    expect(observed.submitEvent?.defaultPrevented).toBe(true)
    host.window.close()
  })

  it('form.requestSubmit 不会绕过 sandbox 表单拦截，并保留 submitter', () => {
    const { frameWindow, host } = createSandboxDom('<form><button type="submit">提交</button></form>')
    const form = frameWindow.document.querySelector('form')
    const button = frameWindow.document.querySelector('button')
    const observed = { submitEvent: null as SubmitEvent | null }
    form?.addEventListener('submit', (event) => {
      observed.submitEvent = event as SubmitEvent
    })

    form?.requestSubmit(button ?? undefined)

    expect(observed.submitEvent?.defaultPrevented).toBe(true)
    expect(observed.submitEvent?.submitter).toBe(button)
    host.window.close()
  })

  it('接收父窗口连接后先回报 ready，再应用 init 主题并回报 resize', () => {
    const { frameWindow, host } = createSandboxDom('<section>内容</section>')
    const sent: unknown[] = []
    const port = {
      onmessage: undefined as ((event: MessageEvent) => void) | undefined,
      postMessage: (message: unknown) => sent.push(message),
      start: () => undefined,
    }

    const connectEvent = new frameWindow.MessageEvent('message', {
      data: { type: 'visualization-connect' },
      source: host.window as unknown as MessageEventSource,
    })
    Object.defineProperty(connectEvent, 'ports', { value: [port] })
    frameWindow.dispatchEvent(connectEvent)

    expect(sent).toEqual([{ type: 'ready' }])

    port.onmessage?.({ data: { type: 'init', artifactId: 'viz-1', theme: { mode: 'dark', tokens: { background: '#111', fontSans: 'Nunito Sans Variable, sans-serif', radius: '0.75rem' } } } } as MessageEvent)

    expect(frameWindow.document.documentElement.dataset.theme).toBe('dark')
    expect(frameWindow.document.documentElement.style.getPropertyValue('--viz-background')).toBe('')
    expect(frameWindow.document.getElementById('ant-chat-viz-theme')?.textContent).toContain('--viz-background:#111')
    expect(frameWindow.document.getElementById('ant-chat-viz-theme')?.textContent).toContain('--viz-font-sans:Nunito Sans Variable, sans-serif')
    expect(frameWindow.document.getElementById('ant-chat-viz-theme')?.textContent).toContain('--viz-radius:0.75rem')
    port.onmessage?.({ data: { type: 'theme', theme: { mode: 'light', tokens: { fontSans: 'Inter, sans-serif', radius: '1rem' } } } } as MessageEvent)
    expect(frameWindow.document.getElementById('ant-chat-viz-theme')?.textContent).toContain('--viz-font-sans:Inter, sans-serif')
    expect(frameWindow.document.getElementById('ant-chat-viz-theme')?.textContent).toContain('--viz-radius:1rem')
    expect(sent.filter(message => (message as { type?: string }).type === 'ready')).toHaveLength(1)
    expect(sent).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'resize' })]))
    host.window.close()
  })
})
