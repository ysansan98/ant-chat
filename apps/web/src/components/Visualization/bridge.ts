import type {
  FrameToHost,
  VisualizationAction,
  VisualizationBlockLike,
  VisualizationField,
  VisualizationPrimitive,
  VisualizationSpec,
  VisualizationTheme,
} from './types'
import {
  VisualizationSpecV1Schema,
} from '@ant-chat/shared'
import { getAppRpcClient } from '@/api/transports/appRpc'

const MAX_ARTIFACT_BYTES = 512 * 1024
const MAX_STRING_LENGTH = 4_000

const FALLBACK_THEME: VisualizationTheme = {
  mode: 'light',
  tokens: {
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(222 47% 11%)',
    card: 'hsl(0 0% 100%)',
    border: 'hsl(214 32% 91%)',
    mutedForeground: 'hsl(215 16% 47%)',
    chart1: 'hsl(221 83% 53%)',
    chart2: 'hsl(160 84% 39%)',
    chart3: 'hsl(38 92% 50%)',
    chart4: 'hsl(262 83% 58%)',
    chart5: 'hsl(346 77% 50%)',
  },
}

export interface LoadedVisualizationArtifact {
  rawData: string
  spec: VisualizationSpec
}

export function clampFrameHeight(height: number): number {
  if (!Number.isFinite(height))
    return 240
  return Math.min(1200, Math.max(96, Math.round(height)))
}

function getCssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined')
    return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function getVisualizationTheme(): VisualizationTheme {
  const isDark = typeof document !== 'undefined'
    && document.documentElement.classList.contains('dark')
  const token = (name: string, fallback: string) => getCssToken(name, fallback)
  const fallbacks = FALLBACK_THEME.tokens

  return {
    mode: isDark ? 'dark' : 'light',
    tokens: {
      background: token('--background', fallbacks.background),
      foreground: token('--foreground', fallbacks.foreground),
      card: token('--card', fallbacks.card),
      border: token('--border', fallbacks.border),
      mutedForeground: token('--muted-foreground', fallbacks.mutedForeground),
      chart1: token('--chart-1', fallbacks.chart1),
      chart2: token('--chart-2', fallbacks.chart2),
      chart3: token('--chart-3', fallbacks.chart3),
      chart4: token('--chart-4', fallbacks.chart4),
      chart5: token('--chart-5', fallbacks.chart5),
    },
  }
}

function decodeArtifactData(data: string): Uint8Array {
  const trimmed = data.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('['))
    return new TextEncoder().encode(data)
  try {
    const binary = atob(trimmed)
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  }
  catch {
    throw new Error('可视化 artifact 不是有效 JSON 或 Base64')
  }
}

export function parseVisualizationSpec(rawData: string): VisualizationSpec {
  if (new TextEncoder().encode(rawData).byteLength > MAX_ARTIFACT_BYTES)
    throw new Error('可视化 artifact 超出大小限制')

  let value: unknown
  try {
    value = JSON.parse(rawData)
  }
  catch {
    throw new Error('可视化 artifact 不是有效 JSON')
  }
  const parsed = VisualizationSpecV1Schema.safeParse(value)
  if (!parsed.success)
    throw new Error(parsed.error.issues[0]?.message || '可视化 spec 校验失败')
  return parsed.data
}

export async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle)
    throw new Error('当前环境不支持 artifact hash 校验')
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = await subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function loadVisualizationArtifact(
  block: VisualizationBlockLike,
  ownership?: { conversationId: string, messageId: string },
): Promise<LoadedVisualizationArtifact> {
  const encodedData = block.data ?? (ownership?.conversationId && ownership.messageId
    ? await getAppRpcClient().call('visualizations.get', {
        ...ownership,
        fileId: block.source.file_id,
      })
    : null)
  if (!encodedData)
    throw new Error('可视化 artifact 尚未加载')
  const bytes = decodeArtifactData(encodedData)
  if (bytes.byteLength > MAX_ARTIFACT_BYTES)
    throw new Error('可视化 artifact 超出大小限制')
  const actualHash = await sha256Hex(bytes)
  if (actualHash !== block.sha256)
    throw new Error('可视化 artifact 校验失败')
  const rawData = new TextDecoder().decode(bytes)
  return { rawData, spec: parseVisualizationSpec(rawData) }
}

function getFormFields(spec: VisualizationSpec): VisualizationField[] {
  return spec.views.flatMap(view => (view.type === 'form' ? view.fields : []))
}

function getAction(spec: VisualizationSpec, actionId: string): VisualizationAction | undefined {
  return spec.actions?.find(action => action.id === actionId)
}

function validatePrimitive(value: unknown): value is VisualizationPrimitive {
  return value === null
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
    || typeof value === 'boolean'
}

function isValueAllowed(field: VisualizationField, value: unknown): value is VisualizationPrimitive {
  if (!validatePrimitive(value))
    return false
  if (typeof value === 'string' && value.length > MAX_STRING_LENGTH)
    return false
  if (field.type === 'range') {
    return typeof value === 'number' && value >= field.min && value <= field.max
  }
  if (field.type === 'checkbox' || field.type === 'toggle')
    return typeof value === 'boolean'
  if (field.type === 'select' || field.type === 'radio')
    return typeof value === 'string' && field.options.some(option => option.value === value)
  return typeof value === 'string'
}

export function validateFollowUpRequest(
  spec: VisualizationSpec,
  request: Extract<FrameToHost, { type: 'follow-up-request' }>,
  artifactId: string,
): boolean {
  if (request.artifactId !== artifactId || !request.actionId || !getAction(spec, request.actionId))
    return false
  const fields = getFormFields(spec)
  const fieldsById = new Map(fields.map(field => [field.id, field]))
  for (const [key, value] of Object.entries(request.values)) {
    const field = fieldsById.get(key)
    if (!field || !isValueAllowed(field, value))
      return false
  }
  return fields.every(field => !field.required || isValueAllowed(field, request.values[field.id]))
}
