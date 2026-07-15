import type { VisualizationBlockLike } from '../types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppRpcClient } from '@/api/transports/appRpc'
import { clampFrameHeight, getInitialFrameHeight, getVisualizationTheme, loadVisualizationArtifact } from '../bridge'
import { createVisualizationSandboxDocument } from '../sandboxDocument'

vi.mock('@/api/transports/appRpc', () => ({ getAppRpcClient: vi.fn() }))

const html = '<section class="card" style="color: var(--viz-foreground)"><h2>阶段延迟</h2><button onclick="window.antChatVisualization.sendFollowUpMessage({ prompt: \'继续\' })">继续</button></section>'

function createBlock(): VisualizationBlockLike {
  const bytes = new TextEncoder().encode(html)
  return {
    type: 'visualization',
    source: { type: 'file_id', file_id: 'viz-1' },
    format: 'ant-chat.visualization.html.v1',
    title: '阶段延迟',
    summary: '比较不同阶段的延迟',
    size: bytes.byteLength,
    sha256: 'a'.repeat(64),
  }
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach(byte => binary += String.fromCharCode(byte))
  return btoa(binary)
}

describe('visualization bridge', () => {
  const rpcCall = vi.fn()
  beforeEach(() => {
    vi.mocked(getAppRpcClient).mockReturnValue({ call: rpcCall } as never)
    rpcCall.mockResolvedValue(encodeBase64(html))
  })
  afterEach(() => {
    vi.clearAllMocks()
    document.documentElement.classList.remove('dark')
    document.documentElement.style.removeProperty('--font-sans')
    document.documentElement.style.removeProperty('--radius')
    document.documentElement.style.removeProperty('--primary')
    document.documentElement.style.removeProperty('--background')
    document.documentElement.style.removeProperty('--card')
  })

  it('通过 backend 回源加载 HTML artifact，hash 完整性由 backend 负责', async () => {
    const block = createBlock()
    await expect(loadVisualizationArtifact(block, { conversationId: 'conv-1', messageId: 'msg-1' })).resolves.toEqual({ html })
    expect(rpcCall).toHaveBeenCalledWith('visualizations.get', { conversationId: 'conv-1', messageId: 'msg-1', fileId: 'viz-1' })
  })

  it('没有所有权上下文时不接受 inline bytes', async () => {
    const block = createBlock()
    await expect(loadVisualizationArtifact({ ...block, data: encodeBase64(html) })).rejects.toThrow('所有权上下文缺失')
    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('从应用设计 token 生成 iframe 主题快照', () => {
    document.documentElement.classList.add('dark')
    document.documentElement.style.setProperty('--font-sans', 'Nunito Sans Variable, sans-serif')
    document.documentElement.style.setProperty('--radius', '0.75rem')
    document.documentElement.style.setProperty('--primary', 'oklch(0.78 0.06 230)')

    expect(getVisualizationTheme()).toMatchObject({
      mode: 'dark',
      tokens: {
        primary: 'oklch(0.78 0.06 230)',
        fontSans: 'Nunito Sans Variable, sans-serif',
        radius: '0.75rem',
      },
    })
  })

  it('创建 iframe 时先写入当前宿主主题，而不是使用独立色板', () => {
    document.documentElement.style.setProperty('--background', 'oklch(0.21 0.03 260)')
    document.documentElement.style.setProperty('--card', 'oklch(0.27 0.03 260)')
    document.documentElement.style.setProperty('--primary', 'oklch(0.75 0.1 230)')
    document.documentElement.style.setProperty('--font-sans', 'Nunito Sans Variable, sans-serif')
    document.documentElement.style.setProperty('--radius', '0.75rem')

    const sandboxDocument = createVisualizationSandboxDocument(html, getVisualizationTheme())

    expect(sandboxDocument).toContain('id="ant-chat-viz-theme">:root{')
    expect(sandboxDocument).toContain('--viz-background:oklch(0.21 0.03 260)')
    expect(sandboxDocument).toContain('--viz-card:oklch(0.27 0.03 260)')
    expect(sandboxDocument).toContain('--viz-primary:oklch(0.75 0.1 230)')
    expect(sandboxDocument).toContain('--viz-font-sans:Nunito Sans Variable, sans-serif')
    expect(sandboxDocument).toContain('--viz-radius:0.75rem')
    expect(sandboxDocument).toContain('<body style="background:var(--viz-background)">')
    expect(sandboxDocument).not.toContain('hsl(221 83% 53%)')
  })

  it('允许内联样式和事件属性的 fragment 在 sandbox 中运行', async () => {
    expect(getInitialFrameHeight(320)).toBe(360)
    expect(getInitialFrameHeight(900)).toBe(612)
    expect(getInitialFrameHeight(2_000)).toBe(720)
    expect(clampFrameHeight(2)).toBe(96)
    expect(clampFrameHeight(5000)).toBe(1200)
    const document = createVisualizationSandboxDocument(html, getVisualizationTheme())
    expect(document).toContain('default-src \'none\'')
    expect(document).toContain('connect-src \'none\'')
    expect(document).toContain('script-src \'unsafe-inline\'')
    expect(document).toContain('style-src \'unsafe-inline\'')
    expect(document).toContain('id="ant-chat-viz-theme"')
    expect(document).toContain('window.antChatVisualization')
    expect(document).toContain(html)
    expect(document).not.toContain('allow-same-origin')
    expect(document.indexOf('window.antChatVisualization')).toBeLessThan(document.indexOf(html))
  })
})
