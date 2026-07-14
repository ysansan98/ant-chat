import { describe, expect, it } from 'vitest'

import {
  canonicalizeVisualizationSpec,
  FrameToHostMessageSchema,
  getVisualizationSpecSize,
  HostToFrameMessageSchema,
  serializeVisualizationSpec,
  VISUALIZATION_LIMITS,
  VisualizationBlockSchema,
  VisualizationSpecV1Schema,
} from '../../schemas'
import type { AgentTool } from '../agent-tools'

function createSpec(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    title: '延迟趋势',
    summary: '展示请求延迟变化。',
    data: {
      latency: [
        { time: '10:00', value: 120 },
        { time: '10:05', value: 180 },
      ],
    },
    layout: { type: 'stack' },
    views: [{
      type: 'line',
      id: 'latency-chart',
      dataset: 'latency',
      x: 'time',
      y: ['value'],
    }],
    ...overrides,
  }
}

describe('visualization v1 共享合同', () => {
  it('接受受限 DSL，并对同一语义 spec 生成稳定序列化结果', () => {
    const first = createSpec()
    const second = createSpec({
      data: { latency: [{ value: 120, time: '10:00' }, { value: 180, time: '10:05' }] },
    })

    expect(VisualizationSpecV1Schema.parse(first)).toMatchObject({ version: 1 })
    expect(serializeVisualizationSpec(first)).toBe(serializeVisualizationSpec(second))
    expect(getVisualizationSpecSize(first)).toBeGreaterThan(0)
    expect(canonicalizeVisualizationSpec(first)).toEqual(canonicalizeVisualizationSpec(second))
  })

  it('拒绝 URL、原始标记和未知节点，避免 DSL 退化成任意内容执行器', () => {
    expect(() => VisualizationSpecV1Schema.parse(createSpec({ data: { latency: [{ value: 'https://example.com' }] } }))).toThrow()
    expect(() => VisualizationSpecV1Schema.parse(createSpec({ summary: '<script>alert(1)</script>' }))).toThrow()
    expect(() => VisualizationSpecV1Schema.parse(createSpec({ views: [{ type: 'html', id: 'unsafe' }] }))).toThrow()
  })

  it('拒绝超出总行数、节点数、AST 深度、字符串和总字节上限的 spec', () => {
    const tooManyRows = Array.from({ length: VISUALIZATION_LIMITS.maxRows + 1 }, (_, index) => ({ value: index }))
    expect(() => VisualizationSpecV1Schema.parse(createSpec({ data: { latency: tooManyRows } }))).toThrow()

    const tooManyViews = Array.from({ length: VISUALIZATION_LIMITS.maxNodes + 1 }, (_, index) => ({
      type: 'line',
      id: `chart-${index}`,
      dataset: 'latency',
      x: 'time',
      y: ['value'],
    }))
    expect(() => VisualizationSpecV1Schema.parse(createSpec({ views: tooManyViews }))).toThrow()

    let expression: Record<string, unknown> = { type: 'literal', value: true }
    for (let index = 0; index < VISUALIZATION_LIMITS.maxDepth; index++) expression = { type: 'not', operand: expression }
    expect(() => VisualizationSpecV1Schema.parse(createSpec({
      views: [{ type: 'line', id: 'deep', dataset: 'latency', x: 'time', y: ['value'], filter: expression }],
    }))).toThrow()

    expect(() => VisualizationSpecV1Schema.parse(createSpec({ title: 'x'.repeat(VISUALIZATION_LIMITS.maxStringLength + 1) }))).toThrow()
    const largeRows = Array.from({ length: VISUALIZATION_LIMITS.maxRows }, () => ({ value: 'x'.repeat(80) }))
    expect(() => VisualizationSpecV1Schema.parse(createSpec({ data: { latency: largeRows } }))).toThrow()
  })

  it('只允许 file_id 可视化消息块，并校验 hash、格式和大小', () => {
    const block = {
      type: 'visualization',
      source: { type: 'file_id', file_id: 'artifact-1' },
      format: 'ant-chat.visualization.v1',
      title: '延迟趋势',
      summary: '展示请求延迟变化。',
      size: 128,
      sha256: 'a'.repeat(64),
    }

    expect(VisualizationBlockSchema.parse(block)).toEqual(block)
    expect(() => VisualizationBlockSchema.parse({ ...block, source: { type: 'url', url: 'https://example.com' } })).toThrow()
    expect(() => VisualizationBlockSchema.parse({ ...block, sha256: 'A'.repeat(64) })).toThrow()
    expect(() => VisualizationBlockSchema.parse({ ...block, size: VISUALIZATION_LIMITS.maxBytes + 1 })).toThrow()
  })

  it('校验宿主与 iframe 的判别联合消息，并拒绝未知字段', () => {
    const theme = {
      mode: 'dark',
      tokens: {
        background: '#000',
        foreground: '#fff',
        card: '#111',
        border: '#333',
        mutedForeground: '#aaa',
        chart1: '#f00',
        chart2: '#0f0',
        chart3: '#00f',
        chart4: '#ff0',
        chart5: '#0ff',
      },
    } as const

    expect(HostToFrameMessageSchema.parse({ type: 'init', artifactId: 'artifact-1', spec: createSpec(), theme })).toMatchObject({ type: 'init' })
    expect(FrameToHostMessageSchema.parse({
      type: 'follow-up-request',
      requestId: 'request-1',
      artifactId: 'artifact-1',
      actionId: 'submit',
      values: { name: '张三', accepted: true, count: 2, empty: null },
    })).toMatchObject({ type: 'follow-up-request' })
    expect(() => FrameToHostMessageSchema.parse({ type: 'ready', unexpected: true })).toThrow()
    expect(() => FrameToHostMessageSchema.parse({ type: 'resize', height: 1_201 })).toThrow()
  })

  it('支持工具把原始输入映射为可持久化的 public input', () => {
    const tool: AgentTool = {
      name: 'publish_visualization',
      source: 'native',
      operationType: 'write',
      inputSchema: { type: 'object', properties: {}, required: [] },
      inferScope: () => 'workspace',
      toPublicInput: rawInput => ({ title: rawInput.title, format: 'ant-chat.visualization.v1' }),
      execute: async () => ({ ok: true, result: 'published' }),
    }

    expect(tool.toPublicInput?.({ title: '延迟趋势', spec: { secret: '不要持久化' } })).toEqual({
      title: '延迟趋势',
      format: 'ant-chat.visualization.v1',
    })
  })
})
