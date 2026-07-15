import type { VisualizationBlockLike } from '../types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppRpcClient } from '@/api/transports/appRpc'
import { clampFrameHeight, loadVisualizationArtifact, sha256Hex } from '../bridge'
import { createVisualizationSandboxDocument } from '../sandboxDocument'

vi.mock('@/api/transports/appRpc', () => ({ getAppRpcClient: vi.fn() }))

const html = '<section class="card"><h2>阶段延迟</h2></section>'

async function createBlock(): Promise<VisualizationBlockLike> {
  const bytes = new TextEncoder().encode(html)
  return {
    type: 'visualization',
    source: { type: 'file_id', file_id: 'viz-1' },
    format: 'ant-chat.visualization.html.v1',
    title: '阶段延迟',
    summary: '比较不同阶段的延迟',
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
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

  it('通过 backend 回源加载 HTML artifact，并校验 hash/归属', async () => {
    const block = await createBlock()
    await expect(loadVisualizationArtifact(block, { conversationId: 'conv-1', messageId: 'msg-1' })).resolves.toEqual({ html })
    expect(rpcCall).toHaveBeenCalledWith('visualizations.get', { conversationId: 'conv-1', messageId: 'msg-1', fileId: 'viz-1' })
    await expect(loadVisualizationArtifact({ ...block, sha256: '0'.repeat(64) }, { conversationId: 'conv-1', messageId: 'msg-1' })).rejects.toThrow('校验失败')
    await expect(loadVisualizationArtifact({ ...block, size: block.size + 1 }, { conversationId: 'conv-1', messageId: 'msg-1' })).rejects.toThrow('大小校验失败')
  })

  it('没有所有权上下文时不接受 inline bytes', async () => {
    const block = await createBlock()
    await expect(loadVisualizationArtifact({ ...block, data: encodeBase64(html) })).rejects.toThrow('所有权上下文缺失')
    expect(rpcCall).not.toHaveBeenCalled()
  })

  it('限制 iframe 高度并包装 fragment sandbox', async () => {
    expect(clampFrameHeight(2)).toBe(96)
    expect(clampFrameHeight(5000)).toBe(1200)
    const document = createVisualizationSandboxDocument(html)
    expect(document).toContain('default-src \'none\'')
    expect(document).toContain('connect-src \'none\'')
    expect(document).toContain('window.antChatVisualization')
    expect(document).toContain(html)
    expect(document).not.toContain('allow-same-origin')
  })
})
