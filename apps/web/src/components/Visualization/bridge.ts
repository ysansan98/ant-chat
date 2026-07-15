import type { FrameToHost, VisualizationBlockLike, VisualizationTheme } from './types'
import {
  VISUALIZATION_LIMITS,
  VisualizationThemeSchema,
} from '@ant-chat/shared'
import { getAppRpcClient } from '@/api/transports/appRpc'
import { validateVisualizationHtmlFragment } from './fragmentPolicy'

const FALLBACK_THEME: VisualizationTheme = {
  mode: 'light',
  tokens: {
    background: 'hsl(0 0% 100%)',
    foreground: 'hsl(222 47% 11%)',
    card: 'hsl(0 0% 100%)',
    cardForeground: 'hsl(222 47% 11%)',
    primary: 'hsl(221 83% 53%)',
    primaryForeground: 'hsl(210 40% 98%)',
    secondary: 'hsl(210 40% 96%)',
    secondaryForeground: 'hsl(222 47% 11%)',
    muted: 'hsl(210 40% 96%)',
    mutedForeground: 'hsl(215 16% 47%)',
    accent: 'hsl(210 40% 96%)',
    accentForeground: 'hsl(222 47% 11%)',
    destructive: 'hsl(0 84% 60%)',
    destructiveForeground: 'hsl(210 40% 98%)',
    border: 'hsl(214 32% 91%)',
    input: 'hsl(214 32% 91%)',
    ring: 'hsl(221 83% 53%)',
    chart1: 'hsl(221 83% 53%)',
    chart2: 'hsl(160 84% 39%)',
    chart3: 'hsl(38 92% 50%)',
    chart4: 'hsl(262 83% 58%)',
    chart5: 'hsl(346 77% 50%)',
  },
}

export interface LoadedVisualizationArtifact {
  html: string
}

export function clampFrameHeight(height: number): number {
  if (!Number.isFinite(height))
    return 240
  return Math.min(VISUALIZATION_LIMITS.maxFrameHeight, Math.max(96, Math.round(height)))
}

function getCssToken(name: string, fallback: string): string {
  if (typeof document === 'undefined')
    return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

export function getVisualizationTheme(): VisualizationTheme {
  const isDark = typeof document !== 'undefined'
    && (document.documentElement.classList.contains('dark')
      || document.documentElement.getAttribute('data-theme')?.endsWith('-dark') === true)
  const token = (name: string, fallback: string) => getCssToken(name, fallback)
  const fallbacks = FALLBACK_THEME.tokens
  const theme = {
    mode: isDark ? 'dark' as const : 'light' as const,
    tokens: {
      background: token('--background', fallbacks.background),
      foreground: token('--foreground', fallbacks.foreground),
      card: token('--card', fallbacks.card),
      cardForeground: token('--card-foreground', fallbacks.cardForeground),
      primary: token('--primary', fallbacks.primary),
      primaryForeground: token('--primary-foreground', fallbacks.primaryForeground),
      secondary: token('--secondary', fallbacks.secondary),
      secondaryForeground: token('--secondary-foreground', fallbacks.secondaryForeground),
      muted: token('--muted', fallbacks.muted),
      mutedForeground: token('--muted-foreground', fallbacks.mutedForeground),
      accent: token('--accent', fallbacks.accent),
      accentForeground: token('--accent-foreground', fallbacks.accentForeground),
      destructive: token('--destructive', fallbacks.destructive),
      destructiveForeground: token('--destructive-foreground', fallbacks.destructiveForeground),
      border: token('--border', fallbacks.border),
      input: token('--input', fallbacks.input),
      ring: token('--ring', fallbacks.ring),
      chart1: token('--chart-1', fallbacks.chart1),
      chart2: token('--chart-2', fallbacks.chart2),
      chart3: token('--chart-3', fallbacks.chart3),
      chart4: token('--chart-4', fallbacks.chart4),
      chart5: token('--chart-5', fallbacks.chart5),
    },
  }
  const parsed = VisualizationThemeSchema.safeParse(theme)
  return parsed.success ? parsed.data : FALLBACK_THEME
}

function decodeArtifactData(data: string): Uint8Array {
  try {
    const binary = atob(data.trim())
    return Uint8Array.from(binary, character => character.charCodeAt(0))
  }
  catch {
    throw new Error('可视化 artifact 不是有效 Base64')
  }
}

export async function sha256Hex(value: Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle)
    throw new Error('当前环境不支持 artifact hash 校验')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', value as BufferSource)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function loadVisualizationArtifact(
  block: VisualizationBlockLike,
  ownership?: { conversationId: string, messageId: string },
): Promise<LoadedVisualizationArtifact> {
  if (!ownership?.conversationId || !ownership.messageId)
    throw new Error('可视化 artifact 所有权上下文缺失')

  const encodedData = await getAppRpcClient().call('visualizations.get', {
    ...ownership,
    fileId: block.source.file_id,
  })
  if (!encodedData)
    throw new Error('可视化 artifact 尚未加载')
  const bytes = decodeArtifactData(encodedData)
  if (bytes.byteLength > VISUALIZATION_LIMITS.maxBytes)
    throw new Error('可视化 artifact 超出大小限制')
  if (bytes.byteLength !== block.size)
    throw new Error('可视化 artifact 大小校验失败')
  const actualHash = await sha256Hex(bytes)
  if (actualHash !== block.sha256)
    throw new Error('可视化 artifact 校验失败')
  const html = new TextDecoder().decode(bytes)
  const policyError = validateVisualizationHtmlFragment(html)
  if (policyError)
    throw new Error(`可视化 HTML 校验失败：${policyError}`)
  return { html }
}

export function validateFollowUpRequest(
  request: Extract<FrameToHost, { type: 'follow-up-request' }>,
  artifactId: string,
): boolean {
  return request.artifactId === artifactId
    && request.prompt.trim().length > 0
    && request.prompt.length <= VISUALIZATION_LIMITS.maxPromptLength
    && (request.title === undefined || request.title.length <= VISUALIZATION_LIMITS.maxFollowUpTitleLength)
}
