import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { visualizationRuntimeSource } from '../runtime/runtimeSource'

describe('visualization sandbox runtime', () => {
  it('只暴露 follow-up bridge，使用真实 gesture token，并接收主题/resize 消息', () => {
    expect(visualizationRuntimeSource).toContain('window.antChatVisualization')
    expect(visualizationRuntimeSource).toContain('event.isTrusted')
    expect(visualizationRuntimeSource).toContain('type: \'follow-up-request\'')
    expect(visualizationRuntimeSource).toContain('message?.type === \'theme\'')
    expect(visualizationRuntimeSource).toContain('type: \'resize\'')
    expect(visualizationRuntimeSource).not.toContain('window.parent')
    expect(visualizationRuntimeSource).not.toContain('window.electron')
  })

  it('连接后应用主题，并通过 MessagePort 回报 ready/resize', () => {
    const dom = new JSDOM('<!doctype html><html><body><section>内容</section></body></html>', {
      runScripts: 'dangerously',
      url: 'http://localhost',
    })
    const sent: unknown[] = []
    const port = {
      onmessage: undefined as ((event: MessageEvent) => void) | undefined,
      postMessage: (message: unknown) => sent.push(message),
      start: () => undefined,
    }

    dom.window.eval(visualizationRuntimeSource)
    const connectEvent = new dom.window.MessageEvent('message', { data: { type: 'visualization-connect' }, source: dom.window })
    Object.defineProperty(connectEvent, 'ports', { value: [port] })
    dom.window.dispatchEvent(connectEvent)
    port.onmessage?.({ data: { type: 'init', artifactId: 'viz-1', theme: { mode: 'dark', tokens: { background: '#111' } } } } as MessageEvent)

    expect(dom.window.document.documentElement.dataset.theme).toBe('dark')
    expect(dom.window.document.documentElement.style.getPropertyValue('--viz-background')).toBe('#111')
    expect(sent).toEqual(expect.arrayContaining([{ type: 'ready' }, expect.objectContaining({ type: 'resize' })]))
    dom.window.close()
  })
})
