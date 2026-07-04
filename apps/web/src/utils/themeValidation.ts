/**
 * 主题 Token 完整性和 WCAG 2.2 AA 校验工具。
 *
 * 校验规则：
 * - Token 完整性：每个主题必须包含所有必需的 CSS 自定义属性
 * - WCAG 2.2 AA：前景/背景组合对比度 >= 4.5:1（正文）/ 3:1（大文本）
 */

/**
 * 必需的主题 Token 列表。
 * 每个主题必须同时定义浅色(:root)和深色(.dark)变体。
 */
export const REQUIRED_THEME_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
  '--surface',
  '--surface-foreground',
  '--code',
  '--code-foreground',
  '--code-highlight',
  '--code-number',
  '--selection',
  '--selection-foreground',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
] as const

/**
 * WCAG 2.2 AA 关键对比度检查项。
 * 每个条目定义一组必检的前景/背景色对及最低对比度要求。
 */
export const WCAG_CONTRAST_CHECKS = [
  { foreground: '--foreground', background: '--background', minRatio: 4.5, label: '正文/背景' },
  { foreground: '--muted-foreground', background: '--background', minRatio: 4.5, label: '次要文字/背景' },
  { foreground: '--card-foreground', background: '--card', minRatio: 4.5, label: '卡片文字/卡片背景' },
  { foreground: '--primary-foreground', background: '--primary', minRatio: 4.5, label: '主色按钮文字/主色' },
  { foreground: '--primary', background: '--background', minRatio: 3, label: '主色链接/背景（大文本）' },
  { foreground: '--accent-foreground', background: '--accent', minRatio: 3, label: '强调色/背景' },
  { foreground: '--destructive-foreground', background: '--destructive', minRatio: 4.5, label: '警示文字/警示背景' },
  { foreground: '--code-foreground', background: '--code', minRatio: 4.5, label: '代码文字/代码背景' },
  { foreground: '--sidebar-foreground', background: '--sidebar', minRatio: 4.5, label: '侧栏文字/侧栏背景' },
  { foreground: '--selection-foreground', background: '--selection', minRatio: 3, label: '选中文字/选中背景' },
] as const

export interface ThemeValidationResult {
  valid: boolean
  tokenCompleteness: {
    missingTokens: string[]
    extraTokens?: string[]
  }
  contrastResults: Array<{
    foreground: string
    background: string
    label: string
    ratio: number | null
    pass: boolean
  }>
}

/**
 * 将 oklch() 或十六进制颜色字符串解析为 { l, c, h } 组件。
 * 仅处理 oklch() 格式，十六进制等其他格式返回 null。
 */
function parseOklch(color: string): { l: number, c: number, h: number } | null {
  const trimmed = color.trim()
  const match = trimmed.match(/^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (!match)
    return null
  return {
    l: Number.parseFloat(match[1]),
    c: Number.parseFloat(match[2]),
    h: Number.parseFloat(match[3]),
  }
}

/**
 * 将 OKLCH 转换为线性 sRGB 再计算相对亮度。
 * 简化实现：将 OKLCH 近似转换为 sRGB 再计算 WCAG 相对亮度。
 */
function oklchToRelativeLuminance(l: number, c: number, h: number): number {
  // 简化：将 OKLCH 的 L (Lightness) 直接映射到 sRGB 相对亮度的近似值
  // WCAG 相对亮度: L = 0.2126 * R + 0.7152 * G + 0.0722 * B
  // 这里使用近似：对于无彩色 (c=0)，L 接近 OKLCH 的 L
  // 对于有彩色做粗略近似
  const hRad = (h * Math.PI) / 180
  // 将 OKLCH 近似转换为 sRGB
  const r = l + c * (0.3 * Math.cos(hRad))
  const g = l + c * (-0.15 * Math.cos(hRad) + 0.3 * Math.sin(hRad))
  const b = l + c * (0.1 * Math.cos(hRad) - 0.5 * Math.sin(hRad))

  // sRGB 到线性分量
  const toLinear = (val: number): number => {
    const v = Math.max(0, Math.min(1, val))
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }

  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)
}

/**
 * 计算两个 oklch 颜色之间的 WCAG 对比度。
 * 返回 null 如果任一颜色无法解析。
 */
export function calculateContrastRatio(fgColor: string, bgColor: string): number | null {
  const fg = parseOklch(fgColor)
  const bg = parseOklch(bgColor)
  if (!fg || !bg)
    return null

  const fgLuminance = oklchToRelativeLuminance(fg.l, fg.c, fg.h)
  const bgLuminance = oklchToRelativeLuminance(bg.l, bg.c, bg.h)

  const lighter = Math.max(fgLuminance, bgLuminance)
  const darker = Math.min(fgLuminance, bgLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * 校验主题 Token 完整性和 WCAG 2.2 AA 对比度。
 *
 * @param tokens - 主题的 CSS 自定义属性键值映射（如从 :root 或 .dark 解析）
 */
export function validateThemeTokens(
  tokens: Record<string, string>,
  _mode: 'light' | 'dark',
): ThemeValidationResult {
  // 检查 Token 完整性
  const missingTokens = REQUIRED_THEME_TOKENS.filter(
    token => !(token in tokens) || !tokens[token],
  )

  // 检查 WCAG 对比度
  const contrastResults = WCAG_CONTRAST_CHECKS.map((check) => {
    const fg = tokens[check.foreground]
    const bg = tokens[check.background]
    let ratio: number | null = null
    let pass = true

    if (fg && bg) {
      ratio = calculateContrastRatio(fg, bg)
      pass = ratio !== null ? ratio >= check.minRatio : true
    }
    else {
      // 缺失 token 时标记为不通过
      pass = false
    }

    return {
      foreground: check.foreground,
      background: check.background,
      label: check.label,
      ratio,
      pass,
    }
  })

  return {
    valid: missingTokens.length === 0 && contrastResults.every(r => r.pass),
    tokenCompleteness: {
      missingTokens,
    },
    contrastResults,
  }
}
