import type { VisualizationBlockLike } from '../types'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getAppRpcClient } from '@/api/transports/appRpc'
import { VisualizationFrame } from '../VisualizationFrame'

vi.mock('@/api/transports/appRpc', () => ({ getAppRpcClient: vi.fn() }))

const html = '<section><h2>请求延迟</h2><form><label>名称<input name="name"></label><button type="submit">提交</button></form></section>'

function createBlock(): VisualizationBlockLike {
  const bytes = new TextEncoder().encode(html)
  return { type: 'visualization', source: { type: 'file_id', file_id: 'viz-frame-1' }, format: 'ant-chat.visualization.html.v1', title: '请求延迟', summary: '查看阶段延迟', size: bytes.byteLength, sha256: 'a'.repeat(64) }
}

function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach(byte => binary += String.fromCharCode(byte))
  return btoa(binary)
}

describe('visualizationFrame', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
  })

  it('artifact 加载后只创建 allow-scripts iframe，并注入 HTML fragment', async () => {
    vi.mocked(getAppRpcClient).mockReturnValue({ call: vi.fn().mockResolvedValue(encodeBase64(html)) } as never)
    const block = createBlock()
    render(<VisualizationFrame block={block} conversationId="conv-1" messageId="msg-1" />)
    const frame = await screen.findByTitle('请求延迟')
    expect(frame).toHaveAttribute('sandbox', 'allow-scripts')
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame.getAttribute('srcdoc')).toContain(html)
  })

  it('artifact 不存在时显示错误而不是执行任意内容', async () => {
    vi.mocked(getAppRpcClient).mockReturnValue({ call: vi.fn().mockResolvedValue(null) } as never)
    const block = createBlock()
    render(<VisualizationFrame block={block} conversationId="conv-1" messageId="msg-1" />)
    expect(await screen.findByText('可视化无法显示')).toBeInTheDocument()
    expect(screen.getByText('可视化 artifact 尚未加载')).toBeInTheDocument()
  })
})
