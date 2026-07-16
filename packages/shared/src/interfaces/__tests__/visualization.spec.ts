import { describe, expect, it } from 'vitest'
import {
  FrameToHostMessageSchema,
  HostToFrameMessageSchema,
  validateVisualizationHtmlFragment,
  VISUALIZATION_FORMAT,
  VISUALIZATION_LIMITS,
  VisualizationBlockSchema,
  VisualizationThemeSchema,
} from '../../schemas'

const theme = {
  mode: 'dark' as const,
  tokens: {
    background: '#000',
    foreground: '#fff',
    card: '#111',
    cardForeground: '#fff',
    primary: '#0af',
    primaryForeground: '#fff',
    secondary: '#222',
    secondaryForeground: '#fff',
    muted: '#222',
    mutedForeground: '#aaa',
    accent: '#333',
    accentForeground: '#fff',
    destructive: '#f00',
    destructiveForeground: '#fff',
    border: '#333',
    input: '#333',
    ring: '#0af',
    fontSans: 'Nunito Sans Variable, sans-serif',
    radius: '0.625rem',
    chart1: '#f00',
    chart2: '#0f0',
    chart3: '#00f',
    chart4: '#ff0',
    chart5: '#0ff',
  },
}

describe('visualization HTML v1 共享合同', () => {
  it('允许内联样式和事件属性，并拒绝完整 document、宿主 API 和网络请求', () => {
    expect(validateVisualizationHtmlFragment('<section class="card"><h2>趋势</h2><script>button.addEventListener("click", () => window.antChatVisualization.sendFollowUpMessage({ prompt: "继续" }))</script></section>')).toBeNull()
    expect(validateVisualizationHtmlFragment('<section style="color: var(--viz-foreground)"><button onclick="window.antChatVisualization.sendFollowUpMessage({ prompt: \'继续\' })">继续</button></section>')).toBeNull()
    expect(validateVisualizationHtmlFragment('<script src="https://cdn.jsdelivr.net/npm/lucide@1.23.0/dist/umd/lucide.min.js" integrity="sha384-ouAVEJVCMsf8Svzn+BwqbaBhxBEA0xgeVBhHnxmWd+Wqyv18yhWCQwGegFD/OHLq" crossorigin="anonymous"></script>')).toBeNull()
    expect(validateVisualizationHtmlFragment('<!doctype html><html><body>bad</body></html>')).toContain('fragment')
    expect(validateVisualizationHtmlFragment('<iframe src="https://example.com"></iframe>')).toContain('不允许 iframe')
    expect(validateVisualizationHtmlFragment('<script>fetch("/api")</script>')).toContain('网络请求')
    expect(validateVisualizationHtmlFragment('<script src="https://cdn.jsdelivr.net/npm/lucide/dist/umd/lucide.min.js" integrity="sha384-abc" crossorigin="anonymous"></script>')).toContain('白名单')
    expect(validateVisualizationHtmlFragment('<script src="https://cdn.jsdelivr.net/npm/lucide@1.23.0/dist/umd/lucide.min.js" crossorigin="anonymous"></script>')).toContain('sha384')
  })

  it('校验固定格式、artifact hash、大小和完整设计 token', () => {
    const block = {
      type: 'visualization' as const,
      source: { type: 'file_id' as const, file_id: 'artifact-1' },
      format: VISUALIZATION_FORMAT,
      title: '趋势',
      summary: '展示趋势',
      size: 128,
      sha256: 'a'.repeat(64),
    }
    expect(VisualizationBlockSchema.parse(block)).toEqual(block)
    expect(() => VisualizationBlockSchema.parse({ ...block, format: 'legacy.visualization.v1' })).toThrow()
    expect(() => VisualizationBlockSchema.parse({ ...block, size: VISUALIZATION_LIMITS.maxBytes + 1 })).toThrow()
    expect(VisualizationThemeSchema.parse(theme)).toEqual(theme)
    expect(() => VisualizationThemeSchema.parse({ ...theme, tokens: { ...theme.tokens, fontSans: undefined } })).toThrow()
    expect(() => HostToFrameMessageSchema.parse({ type: 'init', artifactId: 'artifact-1', theme: { ...theme, tokens: { ...theme.tokens, radius: undefined } } })).toThrow()
  })

  it('init 不携带 HTML，follow-up 只携带 prompt/title', () => {
    expect(HostToFrameMessageSchema.parse({ type: 'init', artifactId: 'artifact-1', theme })).toMatchObject({ type: 'init' })
    expect(FrameToHostMessageSchema.parse({
      type: 'follow-up-request',
      requestId: 'request-1',
      artifactId: 'artifact-1',
      prompt: '请分析表单结果',
      title: '表单提交',
    })).toMatchObject({ type: 'follow-up-request' })
    expect(() => HostToFrameMessageSchema.parse({ type: 'init', artifactId: 'artifact-1', spec: '<p>不得进入 init</p>', theme })).toThrow()
  })
})
