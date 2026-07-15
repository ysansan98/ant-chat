import type { VisualizationBlockLike } from '../types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppRpcClient } from '@/api/transports/appRpc'
import { clampFrameHeight, getInitialFrameHeight, loadVisualizationArtifact } from '../bridge'
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
  afterEach(() => vi.clearAllMocks())

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

  it('允许内联样式和事件属性的 fragment 在 sandbox 中运行', async () => {
    expect(getInitialFrameHeight(320)).toBe(360)
    expect(getInitialFrameHeight(900)).toBe(612)
    expect(getInitialFrameHeight(2_000)).toBe(720)
    expect(clampFrameHeight(2)).toBe(96)
    expect(clampFrameHeight(5000)).toBe(1200)
    const document = createVisualizationSandboxDocument(html)
    expect(document).toContain('default-src \'none\'')
    expect(document).toContain('connect-src \'none\'')
    expect(document).toContain('script-src \'unsafe-inline\'')
    expect(document).toContain('style-src \'unsafe-inline\'')
    expect(document).toContain('id="ant-chat-viz-theme"')
    expect(document).toContain('window.antChatVisualization')
    expect(document).toContain(html)
    expect(document).not.toContain('allow-same-origin')
  })
})
