import type { AgentTool, AgentToolResult, VisualizationBlockTransport, VisualizationOutputBlocks, VisualizationSpecV1 } from '@ant-chat/shared'
import { Buffer } from 'node:buffer'
import { createHash, randomUUID } from 'node:crypto'
import { canonicalizeVisualizationSpec, serializeVisualizationSpec, VISUALIZATION_FORMAT, VisualizationSpecV1Schema } from '@ant-chat/shared'

export interface VisualizationTool extends AgentTool {
  toPublicInput: (input: Record<string, unknown>) => Record<string, unknown>
}

export function createPublishVisualizationTool(): VisualizationTool {
  return {
    name: 'publish_visualization',
    source: 'skill',
    serverName: 'agent-loop',
    description: '发布一个经过共享 schema 校验的 ant-chat.visualization.v1 JSON 可视化快照。不要传 HTML、CSS、JavaScript、URL 或文件路径。',
    inputSchema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          description: 'VisualizationSpecV1。必须是受限 JSON DSL，不是 HTML 或可执行代码。',
        },
      },
      required: ['spec'],
    },
    operationType: 'skill',
    inferScope: () => 'workspace',
    validateInput: input => parseSpec(input).error,
    toPublicInput,
    execute: async (input): Promise<AgentToolResult> => {
      const parsed = parseSpec(input)
      if (parsed.error) {
        return { ok: false, result: parsed.error }
      }
      const spec = parsed.spec
      const bytes = parsed.bytes
      const sha256 = parsed.sha256
      if (!spec || !bytes || !sha256) {
        return { ok: false, result: '可视化 spec 无效。' }
      }

      const fileId = `viz-${randomUUID()}`
      const block: VisualizationBlockTransport = {
        type: 'visualization',
        source: { type: 'file_id', file_id: fileId },
        format: VISUALIZATION_FORMAT,
        title: spec.title,
        summary: spec.summary,
        size: bytes.byteLength,
        sha256,
        data: bytes.toString('base64'),
      }

      return {
        ok: true,
        result: JSON.stringify({
          title: spec.title,
          format: VISUALIZATION_FORMAT,
          size: bytes.byteLength,
          sha256,
        }),
        diagnostics: { data: { outputBlocks: [block] } satisfies VisualizationOutputBlocks },
      }
    },
  }
}

function parseSpec(input: Record<string, unknown>): {
  spec: VisualizationSpecV1
  serialized: string
  bytes: Buffer
  sha256: string
  error: null
} | {
  spec: undefined
  serialized: undefined
  bytes: undefined
  sha256: undefined
  error: string
} {
  const parsed = VisualizationSpecV1Schema.safeParse(input.spec)
  if (!parsed.success) {
    return {
      spec: undefined,
      serialized: undefined,
      bytes: undefined,
      sha256: undefined,
      error: '可视化 spec 无效。',
    }
  }
  const serialized = serializeVisualizationSpec(parsed.data)
  const bytes = Buffer.from(serialized, 'utf8')
  return {
    spec: canonicalizeVisualizationSpec(parsed.data),
    serialized,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    error: null,
  }
}

function toPublicInput(input: Record<string, unknown>): Record<string, unknown> {
  const parsed = parseSpec(input)
  if (!parsed.error) {
    const spec = parsed.spec
    const bytes = parsed.bytes
    const sha256 = parsed.sha256
    if (!spec || !bytes || !sha256) {
      return { title: '', format: VISUALIZATION_FORMAT, size: 0, sha256: '' }
    }
    return {
      title: spec.title,
      format: VISUALIZATION_FORMAT,
      size: bytes.byteLength,
      sha256,
    }
  }

  const fallback = JSON.stringify(input.spec ?? null)
  const bytes = Buffer.from(fallback, 'utf8')
  return {
    title: typeof (input.spec as { title?: unknown } | undefined)?.title === 'string'
      ? String((input.spec as { title: string }).title).slice(0, 120)
      : '',
    format: VISUALIZATION_FORMAT,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }
}
