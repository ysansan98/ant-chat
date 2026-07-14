import type { VisualizationSpecV1 } from '@ant-chat/shared'
import type { VisualizationBlockLike } from '../types'
import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sha256Hex } from '../bridge'
import { VisualizationFrame } from '../VisualizationFrame'

const spec: VisualizationSpecV1 = {
  version: 1,
  title: '请求延迟',
  summary: '查看阶段延迟',
  data: { latency: [{ stage: '执行', value: 38 }] },
  layout: { type: 'stack' },
  views: [{ id: 'latency-chart', type: 'bar', dataset: 'latency', x: 'stage', y: ['value'] }],
}

async function createBlock(): Promise<VisualizationBlockLike> {
  const raw = JSON.stringify(spec)
  const bytes = new TextEncoder().encode(raw)
  const hash = await sha256Hex(bytes)
  let binary = ''
  bytes.forEach(byte => binary += String.fromCharCode(byte))
  return {
    type: 'visualization',
    source: { type: 'file_id', file_id: 'viz-frame-1' },
    format: 'ant-chat.visualization.v1',
    title: spec.title,
    summary: spec.summary,
    size: bytes.byteLength,
    sha256: hash,
    data: btoa(binary),
  }
}

describe('visualizationFrame', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('artifact 加载后渲染固定 sandbox iframe', async () => {
    vi.stubGlobal('MessageChannel', undefined)
    const block = await createBlock()
    render(<VisualizationFrame block={block} conversationId="" messageId="" />)

    const frame = await screen.findByTitle('请求延迟')
    await waitFor(() => expect(frame).toHaveAttribute('sandbox', 'allow-scripts'))
    expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer')
    expect(frame).toHaveAttribute('srcdoc')
    expect(frame.getAttribute('srcdoc')).toContain('default-src \'none\'')
  })

  it('缺少 artifact bytes 时显示可操作的错误状态而不是执行任意内容', async () => {
    const block = await createBlock()
    render(<VisualizationFrame block={{ ...block, data: undefined }} conversationId="" messageId="" />)

    expect(await screen.findByText('可视化无法显示')).toBeInTheDocument()
    expect(screen.getByText('可视化 artifact 尚未加载')).toBeInTheDocument()
  })
})
