import { VISUALIZATION_FORMAT } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { createPublishVisualizationTool } from '../publishVisualizationTool'

function createSpec(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    title: '延迟趋势',
    summary: '展示请求延迟变化。',
    data: { latency: [{ time: '10:00', value: 120 }] },
    layout: { type: 'stack' },
    views: [{ type: 'line', id: 'latency', dataset: 'latency', x: 'time', y: ['value'] }],
    ...overrides,
  }
}

describe('publish_visualization 工具', () => {
  it('只返回 public descriptor，并通过 outputBlocks 交付带内联数据的新快照', async () => {
    const tool = createPublishVisualizationTool()
    const rawInput = { spec: createSpec() }

    const result = await tool.execute(rawInput)
    const output = JSON.parse(result.result) as Record<string, unknown>
    const block = (result.diagnostics?.data as { outputBlocks: Array<Record<string, unknown>> }).outputBlocks[0]

    expect(output).toEqual(expect.objectContaining({ title: '延迟趋势', format: VISUALIZATION_FORMAT }))
    expect(output).not.toHaveProperty('spec')
    expect(block).toEqual(expect.objectContaining({ type: 'visualization', format: VISUALIZATION_FORMAT, data: expect.any(String) }))
    expect((block.source as { file_id: string }).file_id).not.toBe('file-id-from-model')
    expect(tool.toPublicInput(rawInput)).toEqual(expect.objectContaining({ title: '延迟趋势', format: VISUALIZATION_FORMAT }))
    expect(tool.toPublicInput(rawInput)).not.toHaveProperty('spec')
  })

  it('拒绝 schema 不允许的 spec，且 public input 不携带原始对象', async () => {
    const tool = createPublishVisualizationTool()
    const input = { spec: createSpec({ summary: '<script>secret</script>' }) }

    expect(tool.validateInput?.(input)).toBeTypeOf('string')
    await expect(tool.execute(input)).resolves.toEqual(expect.objectContaining({ ok: false, result: '可视化 spec 无效。' }))
    expect(tool.toPublicInput(input)).not.toHaveProperty('spec')
  })
})
