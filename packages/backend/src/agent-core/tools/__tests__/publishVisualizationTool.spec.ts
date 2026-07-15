import { VISUALIZATION_FORMAT } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { createPublishVisualizationTool } from '../publishVisualizationTool'

const validHtml = '<section class="card" style="color: var(--viz-foreground)"><h2>趋势</h2><button onclick="window.antChatVisualization.sendFollowUpMessage({ prompt: \'继续分析\', title: \'交互提交\' })">提交</button></section>'

describe('publish_visualization 工具', () => {
  it('接受内联样式和事件属性，并返回 descriptor 与 transport artifact', async () => {
    const tool = createPublishVisualizationTool()
    const result = await tool.execute({ title: '趋势', summary: '展示趋势', html: validHtml })
    const output = JSON.parse(result.result) as Record<string, unknown>
    const block = (result.diagnostics?.data as { outputBlocks: Array<Record<string, unknown>> }).outputBlocks[0]

    expect(output).toEqual(expect.objectContaining({
      success: true,
      status: 'published',
      message: '可视化已成功发布，用户可以查看该产物。',
      artifact: expect.objectContaining({ title: '趋势', summary: '展示趋势', format: VISUALIZATION_FORMAT, size: new TextEncoder().encode(validHtml).byteLength }),
    }))
    expect((output.artifact as Record<string, unknown>)).not.toHaveProperty('html')
    expect(block).toEqual(expect.objectContaining({ type: 'visualization', format: VISUALIZATION_FORMAT, data: expect.any(String) }))
    expect(result.result).not.toContain(validHtml)
  })

  it('拒绝路径、file id、hash 和其他未知输入字段', async () => {
    const tool = createPublishVisualizationTool()
    const result = await tool.execute({ title: '趋势', summary: '', html: validHtml, fileId: 'model-file' })
    expect(result.ok).toBe(false)
    expect(JSON.parse(result.result)).toEqual(expect.objectContaining({ success: false, status: 'failed', message: expect.stringContaining('未知字段') }))
  })

  it.each([
    ['完整 document', '<!doctype html><html><body>bad</body></html>'],
    ['iframe', '<iframe src="https://example.com"></iframe>'],
    ['网络请求', '<script>fetch("https://example.com")</script>'],
    ['非白名单 CDN', '<script src="https://example.com/chart.js" integrity="sha384-abc" crossorigin="anonymous"></script>'],
  ])('拒绝%s', async (_name, html) => {
    const tool = createPublishVisualizationTool()
    await expect(tool.execute({ title: 'bad', summary: '', html })).resolves.toMatchObject({ ok: false })
  })
})
