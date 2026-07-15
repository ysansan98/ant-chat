import { z } from 'zod'

export const VISUALIZATION_FORMAT = 'ant-chat.visualization.html.v1' as const

export const VISUALIZATION_LIMITS = {
  maxBytes: 2 * 1024 * 1024,
  maxTitleLength: 120,
  maxSummaryLength: 500,
  maxPromptLength: 4_000,
  maxFollowUpTitleLength: 250,
  maxFrameHeight: 1_200,
  maxOutputBlocks: 10,
} as const

const MAX_ID_LENGTH = 120
const MAX_TRANSPORT_DATA_LENGTH = Math.ceil(VISUALIZATION_LIMITS.maxBytes / 3) * 4 + 16
const identifier = z.string().min(1).max(MAX_ID_LENGTH)
const descriptorText = z.string().max(VISUALIZATION_LIMITS.maxSummaryLength)
const boundedPrompt = z.string().min(1).max(VISUALIZATION_LIMITS.maxPromptLength)

const themeToken = z.string().max(120)

export const VisualizationThemeSchema = z.object({
  mode: z.enum(['light', 'dark']),
  tokens: z.object({
    background: themeToken,
    foreground: themeToken,
    card: themeToken,
    cardForeground: themeToken,
    primary: themeToken,
    primaryForeground: themeToken,
    secondary: themeToken,
    secondaryForeground: themeToken,
    muted: themeToken,
    mutedForeground: themeToken,
    accent: themeToken,
    accentForeground: themeToken,
    destructive: themeToken,
    destructiveForeground: themeToken,
    border: themeToken,
    input: themeToken,
    ring: themeToken,
    fontSans: themeToken,
    radius: themeToken,
    chart1: themeToken,
    chart2: themeToken,
    chart3: themeToken,
    chart4: themeToken,
    chart5: themeToken,
  }).strict(),
}).strict()

export type VisualizationTheme = z.infer<typeof VisualizationThemeSchema>

export const VisualizationBlockSchema = z.object({
  type: z.literal('visualization'),
  source: z.object({ type: z.literal('file_id'), file_id: identifier }).strict(),
  format: z.literal(VISUALIZATION_FORMAT),
  title: z.string().max(VISUALIZATION_LIMITS.maxTitleLength),
  summary: descriptorText,
  size: z.number().int().positive().max(VISUALIZATION_LIMITS.maxBytes),
  sha256: z.string().regex(/^[a-f0-9]{64}$/, 'sha256 必须是小写十六进制摘要'),
  data: z.string().max(MAX_TRANSPORT_DATA_LENGTH).optional(),
}).strict()

export type VisualizationBlock = z.infer<typeof VisualizationBlockSchema>

/** 工具执行阶段携带原始 artifact 的 transport 合同，进入持久化前必须剥离 data。 */
export const VisualizationBlockTransportSchema = VisualizationBlockSchema.extend({
  data: z.string().max(MAX_TRANSPORT_DATA_LENGTH),
}).strict()

export type VisualizationBlockTransport = z.infer<typeof VisualizationBlockTransportSchema>

export const VisualizationOutputBlocksSchema = z.object({
  outputBlocks: z.array(VisualizationBlockTransportSchema).max(VISUALIZATION_LIMITS.maxOutputBlocks),
}).strict()

export type VisualizationOutputBlocks = z.infer<typeof VisualizationOutputBlocksSchema>

export const HostToFrameMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('init'),
    artifactId: identifier,
    theme: VisualizationThemeSchema,
  }).strict(),
  z.object({
    type: z.literal('theme'),
    theme: VisualizationThemeSchema,
  }).strict(),
  z.object({
    type: z.literal('follow-up-result'),
    requestId: identifier,
    accepted: z.boolean(),
  }).strict(),
])

export type HostToFrameMessage = z.infer<typeof HostToFrameMessageSchema>
export const VisualizationHostToFrameMessageSchema = HostToFrameMessageSchema

export const FrameToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready') }).strict(),
  z.object({
    type: z.literal('resize'),
    height: z.number().int().min(0).max(VISUALIZATION_LIMITS.maxFrameHeight),
  }).strict(),
  z.object({
    type: z.literal('follow-up-request'),
    requestId: identifier,
    artifactId: identifier,
    prompt: boundedPrompt,
    title: z.string().max(VISUALIZATION_LIMITS.maxFollowUpTitleLength).optional(),
  }).strict(),
])

export type FrameToHostMessage = z.infer<typeof FrameToHostMessageSchema>
export const VisualizationFrameToHostMessageSchema = FrameToHostMessageSchema

/**
 * 这是故意保守的无 DOM 校验：发布端不能依赖浏览器解析器，sandbox 端仍会由 CSP 做第二道限制。
 * 返回 null 表示通过，否则返回可展示给模型的原因。
 */
export function validateVisualizationHtmlFragment(html: string): string | null {
  if (typeof html !== 'string' || html.trim().length === 0)
    return 'html 必须是非空 HTML fragment'
  if (new TextEncoder().encode(html).byteLength > VISUALIZATION_LIMITS.maxBytes)
    return `html 不能超过 ${VISUALIZATION_LIMITS.maxBytes} 字节`
  if (/<!doctype\b|<\/?(?:html|head|body)\b/i.test(html))
    return 'html 必须是 fragment，不能包含 doctype、html、head 或 body'
  if (/<\/?(?:iframe|object|embed|base|portal|frame)\b/i.test(html))
    return 'html 不允许 iframe、object、embed、base、portal 或 frame'
  if (/<meta\s[^>]*http-equiv\s*=\s*["']?refresh(?:["'\s>]|$)/i.test(html))
    return 'html 不允许 meta refresh'
  if (/javascript:|vbscript:|data:text\/html/i.test(html))
    return 'html 不允许 javascript、vbscript 或 data:text/html URL'
  const imageError = validateImageSources(html)
  if (imageError)
    return imageError
  if (/@import\s+url\s*\(|url\(\s*["']?https?:/i.test(html))
    return 'html 不允许 CSS 外链资源'
  if (/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/i.test(html))
    return 'html 不允许网络请求 API'
  if (/window\s*\.\s*(?:parent|top|opener|electron)|globalThis\s*\.\s*(?:electron|process)|document\s*\.\s*domain/i.test(html))
    return 'html 不允许访问宿主窗口、Electron 或进程对象'

  const externalResourceError = validateExternalResources(html)
  return externalResourceError
}

const ALLOWED_CDN_RESOURCES = new Set([
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.3/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
])

export function isAllowedVisualizationCdnUrl(value: string): boolean {
  return ALLOWED_CDN_RESOURCES.has(value)
}

export function getAllowedVisualizationCdnOrigins(): string[] {
  return ['https://cdn.jsdelivr.net']
}

function validateExternalResources(html: string): string | null {
  const resourcePattern = /<(script|link)\b([^>]*)>/gi
  for (const match of html.matchAll(resourcePattern)) {
    const tagName = match[1].toLowerCase()
    const attributes = match[2]
    const src = readAttribute(attributes, tagName === 'script' ? 'src' : 'href')
    if (!src)
      continue
    if (!isAllowedVisualizationCdnUrl(src))
      return `外部资源不在固定 CDN 白名单：${src}`
    if (!/^sha384-[A-Za-z0-9+/]+={0,2}$/.test(readAttribute(attributes, 'integrity') ?? ''))
      return '外部 CDN 资源必须提供 sha384 SRI integrity'
    if (readAttribute(attributes, 'crossorigin') !== 'anonymous')
      return '外部 CDN 资源必须设置 crossorigin="anonymous"'
  }
  return null
}

function validateImageSources(html: string): string | null {
  const imagePattern = /<(img|audio|video)\b([^>]*)>/gi
  for (const match of html.matchAll(imagePattern)) {
    const src = readAttribute(match[2], 'src')
    if (src && !src.startsWith('data:'))
      return '图片、音频和视频只允许 data: 内联资源'
  }
  return null
}

function readAttribute(attributes: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:["']([^"']+)["']|([^\\s>]+))`, 'i').exec(attributes)
  return match?.[1] ?? match?.[2]
}
