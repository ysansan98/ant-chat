import type { VisualizationSpecV1 } from '@ant-chat/shared'
import type { VisualizationBlockLike } from '../types'
import { describe, expect, it } from 'vitest'
import {
  clampFrameHeight,
  loadVisualizationArtifact,
  sha256Hex,
} from '../bridge'
import { createVisualizationSandboxDocument } from '../sandboxDocument'

const spec: VisualizationSpecV1 = {
  version: 1,
  title: '阶段延迟',
  summary: '比较不同阶段的延迟',
  data: { latency: [{ stage: '排队', value: 12 }, { stage: '执行', value: 38 }] },
  layout: { type: 'stack' },
  views: [{ id: 'latency-chart', type: 'bar', dataset: 'latency', x: 'stage', y: ['value'], unit: '毫秒' }],
}

async function createBlock(payload = JSON.stringify(spec)): Promise<VisualizationBlockLike> {
  const bytes = new TextEncoder().encode(payload)
  const hash = await sha256Hex(bytes)
  let binary = ''
  bytes.forEach(byte => binary += String.fromCharCode(byte))
  return {
    type: 'visualization',
    source: { type: 'file_id', file_id: 'viz-1' },
    format: 'ant-chat.visualization.v1',
    title: spec.title,
    summary: spec.summary,
    size: bytes.byteLength,
    sha256: hash,
    data: btoa(binary),
  }
}

describe('visualization bridge', () => {
  it('只接受 hash 匹配的 Base64 artifact，并解析为共享 V1 spec', async () => {
    const block = await createBlock()

    await expect(loadVisualizationArtifact(block)).resolves.toMatchObject({
      spec: { version: 1, title: '阶段延迟' },
    })
  })

  it('artifact hash 不匹配时拒绝加载', async () => {
    const block = await createBlock()
    await expect(loadVisualizationArtifact({ ...block, sha256: '0'.repeat(64) })).rejects.toThrow('校验失败')
  })

  it('把 runtime resize 限制在安全高度范围', () => {
    expect(clampFrameHeight(2)).toBe(96)
    expect(clampFrameHeight(320.8)).toBe(321)
    expect(clampFrameHeight(5000)).toBe(1200)
  })
})

describe('visualization sandbox document', () => {
  it('固定 CSP、无外部资源，并只嵌入第一方 runtime', () => {
    const document = createVisualizationSandboxDocument()

    expect(document).toContain('default-src \'none\'')
    expect(document).toContain('connect-src \'none\'')
    expect(document).toContain('form-action \'none\'')
    expect(document).toContain('visualization-connect')
    expect(document).not.toContain('fetch(')
    expect(document).not.toContain('window.electron')
  })
})
