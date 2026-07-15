import type { AgentTool, AgentToolResult, VisualizationBlockTransport, VisualizationOutputBlocks } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import {
  validateVisualizationHtmlFragment,
  VISUALIZATION_FORMAT,
  VISUALIZATION_LIMITS,
} from '@ant-chat/shared'

export function createPublishVisualizationTool(): AgentTool {
  return {
    name: 'publish_visualization',
    source: 'skill',
    serverName: 'agent-loop',
    description: '发布一个运行在安全 sandbox iframe 中的 HTML 可视化 fragment。输入必须是 { title, summary, html }；html 可包含语义化 HTML、内联 style/script 和固定版本 CDN 图表库，但不能包含完整 document、宿主 API 或网络请求。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: `可视化标题，最多 ${VISUALIZATION_LIMITS.maxTitleLength} 个字符。` },
        summary: { type: 'string', description: `可视化摘要，最多 ${VISUALIZATION_LIMITS.maxSummaryLength} 个字符。` },
        html: { type: 'string', description: `HTML fragment，最多 ${VISUALIZATION_LIMITS.maxBytes} 字节；不要传完整 HTML document。` },
      },
      required: ['title', 'summary', 'html'],
    },
    operationType: 'skill',
    inferScope: () => 'workspace',
    validateInput: input => parseVisualizationInput(input).error,
    execute: async (input): Promise<AgentToolResult> => {
      const parsed = parseVisualizationInput(input)
      if (parsed.error)
        return { ok: false, result: createVisualizationToolFailureResult(parsed.error) }
      const valid = parsed as ParsedVisualizationInput

      const fileId = `viz-${randomUUID()}`
      const block: VisualizationBlockTransport = {
        type: 'visualization',
        source: { type: 'file_id', file_id: fileId },
        format: VISUALIZATION_FORMAT,
        title: valid.title,
        summary: valid.summary,
        size: valid.bytes.byteLength,
        sha256: valid.sha256,
        data: valid.bytes.toString('base64'),
      }

      const descriptor = createVisualizationDescriptor(valid.title, valid.summary, valid.bytes, valid.sha256)
      return {
        ok: true,
        result: JSON.stringify({
          success: true,
          status: 'published',
          message: '可视化已成功发布，用户可以查看该产物。',
          artifact: descriptor,
        }),
        diagnostics: { data: { outputBlocks: [block] } satisfies VisualizationOutputBlocks },
      }
    },
  }
}

interface ParsedVisualizationInput {
  title: string
  summary: string
  html: string
  bytes: Buffer
  sha256: string
  error: null
}

interface InvalidVisualizationInput {
  title: undefined
  summary: undefined
  html: undefined
  bytes: undefined
  sha256: undefined
  error: string
}

function parseVisualizationInput(input: Record<string, unknown>): ParsedVisualizationInput | InvalidVisualizationInput {
  const unknownKeys = Object.keys(input).filter(key => !['title', 'summary', 'html'].includes(key))
  if (unknownKeys.length > 0)
    return invalidInput(`publish_visualization 不允许未知字段：${unknownKeys.join('、')}`)
  const title = input.title
  const summary = input.summary
  const html = input.html
  if (typeof title !== 'string' || title.length > VISUALIZATION_LIMITS.maxTitleLength)
    return invalidInput('title 必须是字符串且不能超过 120 个字符')
  if (typeof summary !== 'string' || summary.length > VISUALIZATION_LIMITS.maxSummaryLength)
    return invalidInput('summary 必须是字符串且不能超过 500 个字符')
  if (typeof html !== 'string')
    return invalidInput('html 必须是字符串')

  const policyError = validateVisualizationHtmlFragment(html)
  if (policyError)
    return invalidInput(`可视化 HTML 校验失败：${policyError}`)

  const bytes = Buffer.from(html, 'utf8')
  const sha256 = createHash('sha256').update(bytes).digest('hex')
  return { title, summary, html, bytes, sha256, error: null }
}

function invalidInput(error: string): InvalidVisualizationInput {
  return { title: undefined, summary: undefined, html: undefined, bytes: undefined, sha256: undefined, error }
}

export function createVisualizationToolFailureResult(message: string): string {
  try {
    const parsed = JSON.parse(message) as { success?: unknown, status?: unknown, message?: unknown }
    if (parsed.success === false && parsed.status === 'failed' && typeof parsed.message === 'string')
      return message
  }
  catch {
    // 普通错误文本继续包装为结构化失败结果。
  }
  return JSON.stringify({
    success: false,
    status: 'failed',
    message,
  })
}

export function createVisualizationDescriptor(
  title: string,
  summary: string,
  bytes: Uint8Array,
  sha256: string,
): Record<string, unknown> {
  return {
    title,
    summary,
    format: VISUALIZATION_FORMAT,
    size: bytes.byteLength,
    sha256,
  }
}

/** trace、tool-call args 和模型上下文只能看到 descriptor，不能复制 HTML 正文。 */
export function getVisualizationToolInputDescriptor(input: Record<string, unknown>): Record<string, unknown> {
  const title = typeof input.title === 'string' ? input.title.slice(0, VISUALIZATION_LIMITS.maxTitleLength) : ''
  const summary = typeof input.summary === 'string' ? input.summary.slice(0, VISUALIZATION_LIMITS.maxSummaryLength) : ''
  const html = typeof input.html === 'string' ? input.html : ''
  const bytes = Buffer.from(html, 'utf8')
  return createVisualizationDescriptor(title, summary, bytes, createHash('sha256').update(bytes).digest('hex'))
}
