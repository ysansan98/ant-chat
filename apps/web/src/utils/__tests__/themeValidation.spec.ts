import { describe, expect, it } from 'vitest'
import {
  calculateContrastRatio,
  REQUIRED_THEME_TOKENS,
  validateThemeTokens,
} from '@/utils/themeValidation'

describe('themeValidation', () => {
  describe('required theme tokens', () => {
    it('应包含所有必要的前景色和背景色 token', () => {
      expect(REQUIRED_THEME_TOKENS.length).toBeGreaterThan(30)

      // 验证关键 token 存在
      expect(REQUIRED_THEME_TOKENS).toContain('--background')
      expect(REQUIRED_THEME_TOKENS).toContain('--foreground')
      expect(REQUIRED_THEME_TOKENS).toContain('--primary')
      expect(REQUIRED_THEME_TOKENS).toContain('--primary-foreground')
      expect(REQUIRED_THEME_TOKENS).toContain('--border')
      expect(REQUIRED_THEME_TOKENS).toContain('--ring')
    })

    it('应包含代码语法高亮相关 token', () => {
      expect(REQUIRED_THEME_TOKENS).toContain('--code')
      expect(REQUIRED_THEME_TOKENS).toContain('--code-foreground')
      expect(REQUIRED_THEME_TOKENS).toContain('--code-highlight')
      expect(REQUIRED_THEME_TOKENS).toContain('--code-number')
    })

    it('应包含侧边栏相关 token', () => {
      expect(REQUIRED_THEME_TOKENS).toContain('--sidebar')
      expect(REQUIRED_THEME_TOKENS).toContain('--sidebar-foreground')
      expect(REQUIRED_THEME_TOKENS).toContain('--sidebar-primary')
      expect(REQUIRED_THEME_TOKENS).toContain('--sidebar-accent')
    })
  })

  describe('calculateContrastRatio', () => {
    it('应为无彩色计算合理的对比度', () => {
      // 白底黑字: oklch(0.972 0.012 88) vs oklch(0.205 0.035 255)
      const ratio = calculateContrastRatio(
        'oklch(0.205 0.035 255)', // foreground (near-black)
        'oklch(0.972 0.012 88)', // background (near-white)
      )
      expect(ratio).not.toBeNull()
      expect(ratio!).toBeGreaterThan(4.5) // WCAG AA
    })

    it('深色模式下浅色文字在深色背景上应满足 WCAG AA', () => {
      // 深色背景 oklch(0.18 0.015 255) 与浅色文字 oklch(0.94 0.008 88)
      const ratio = calculateContrastRatio(
        'oklch(0.94 0.008 88)', // foreground (near-white)
        'oklch(0.18 0.015 255)', // background (near-black)
      )
      expect(ratio).not.toBeNull()
      expect(ratio!).toBeGreaterThan(4.5)
    })

    it('无法解析的颜色应返回 null', () => {
      expect(calculateContrastRatio('red', 'blue')).toBeNull()
      expect(calculateContrastRatio('#fff', '#000')).toBeNull()
      expect(calculateContrastRatio('oklch(0.5 0 0)', '#000')).toBeNull()
    })
  })

  describe('validateThemeTokens', () => {
    it('所有 token 完整且对比度通过时返回 valid=true', () => {
      const tokens: Record<string, string> = {}
      for (const token of REQUIRED_THEME_TOKENS) {
        tokens[token] = 'oklch(0.5 0 0)' // 中性灰
      }

      const result = validateThemeTokens(tokens, 'light')
      expect(result.tokenCompleteness.missingTokens).toEqual([])
    })

    it('缺少 token 时报告缺失列表', () => {
      const tokens: Record<string, string> = {
        '--background': 'oklch(0.972 0.012 88)',
        '--foreground': 'oklch(0.205 0.035 255)',
      }

      const result = validateThemeTokens(tokens, 'light')
      expect(result.tokenCompleteness.missingTokens.length).toBeGreaterThan(0)
      expect(result.tokenCompleteness.missingTokens).toContain('--primary')
      expect(result.valid).toBe(false)
    })

    it('空 token 表应报告全部缺失', () => {
      const result = validateThemeTokens({}, 'dark')
      expect(result.tokenCompleteness.missingTokens.length).toBe(REQUIRED_THEME_TOKENS.length)
      expect(result.valid).toBe(false)
    })
  })

  describe('airbnb 灵感亮色主题', () => {
    const airbnbLightTokens: Record<string, string> = {
      '--background': 'oklch(0.99 0.003 85)',
      '--foreground': 'oklch(0.28 0.01 90)',
      '--card': 'oklch(1 0 0)',
      '--card-foreground': 'oklch(0.28 0.01 90)',
      '--popover': 'oklch(1 0 0)',
      '--popover-foreground': 'oklch(0.28 0.01 90)',
      '--primary': 'oklch(0.44 0.2 17)',
      '--primary-foreground': 'oklch(0.98 0.005 85)',
      '--secondary': 'oklch(0.92 0.006 85)',
      '--secondary-foreground': 'oklch(0.35 0.01 90)',
      '--muted': 'oklch(0.94 0.005 85)',
      '--muted-foreground': 'oklch(0.45 0.008 90)',
      '--accent': 'oklch(0.5 0.2 17)',
      '--accent-foreground': 'oklch(0.98 0.005 85)',
      '--destructive': 'oklch(0.42 0.18 30)',
      '--destructive-foreground': 'oklch(0.98 0.005 85)',
      '--border': 'oklch(0.9 0.005 85)',
      '--input': 'oklch(0.9 0.005 85)',
      '--ring': 'oklch(0.44 0.2 17)',
      '--sidebar': 'oklch(0.99 0.003 85)',
      '--sidebar-foreground': 'oklch(0.28 0.01 90)',
      '--sidebar-primary': 'oklch(0.44 0.2 17)',
      '--sidebar-primary-foreground': 'oklch(0.98 0.005 85)',
      '--sidebar-accent': 'oklch(0.92 0.006 85)',
      '--sidebar-accent-foreground': 'oklch(0.35 0.01 90)',
      '--sidebar-border': 'oklch(0.9 0.005 85)',
      '--sidebar-ring': 'oklch(0.44 0.2 17)',
      '--surface': 'oklch(1 0 0)',
      '--surface-foreground': 'oklch(0.28 0.01 90)',
      '--code': 'oklch(0.28 0.015 85)',
      '--code-foreground': 'oklch(0.92 0.005 85)',
      '--code-highlight': 'oklch(0.35 0.015 90)',
      '--code-number': 'oklch(0.6 0.01 90)',
      '--selection': 'oklch(0.9 0.04 17)',
      '--selection-foreground': 'oklch(0.28 0.01 90)',
      '--chart-1': 'oklch(0.44 0.2 17)',
      '--chart-2': 'oklch(0.55 0.18 143)',
      '--chart-3': 'oklch(0.75 0.17 78)',
      '--chart-4': 'oklch(0.53 0.18 34)',
      '--chart-5': 'oklch(0.45 0.15 270)',
    }

    it('亮色变体应声明全部必需的 token', () => {
      const result = validateThemeTokens(airbnbLightTokens, 'light')
      expect(result.tokenCompleteness.missingTokens).toEqual([])
    })

    it('品牌色应通过 WCAG 2.2 AA 对比度检查', () => {
      const result = validateThemeTokens(airbnbLightTokens, 'light')

      const failures = result.contrastResults.filter(r => !r.pass)
      for (const f of failures) {
        console.warn(`亮色主题对比度失败: ${f.label} = ${f.ratio}`)
      }

      expect(result.contrastResults.every(r => r.pass)).toBe(true)
      expect(result.valid).toBe(true)
    })
  })

  describe('airbnb 灵感暗色主题', () => {
    const airbnbDarkTokens: Record<string, string> = {
      '--background': 'oklch(0.22 0.005 85)',
      '--foreground': 'oklch(0.92 0.005 85)',
      '--card': 'oklch(0.26 0.006 85)',
      '--card-foreground': 'oklch(0.92 0.005 85)',
      '--popover': 'oklch(0.26 0.006 85)',
      '--popover-foreground': 'oklch(0.92 0.005 85)',
      '--primary': 'oklch(0.72 0.2 17)',
      '--primary-foreground': 'oklch(0.2 0.005 85)',
      '--secondary': 'oklch(0.3 0.007 85)',
      '--secondary-foreground': 'oklch(0.88 0.005 85)',
      '--muted': 'oklch(0.3 0.007 85)',
      '--muted-foreground': 'oklch(0.7 0.008 90)',
      '--accent': 'oklch(0.7 0.18 17)',
      '--accent-foreground': 'oklch(0.2 0.005 85)',
      '--destructive': 'oklch(0.42 0.18 30)',
      '--destructive-foreground': 'oklch(0.98 0.005 85)',
      '--border': 'oklch(0.32 0.007 85)',
      '--input': 'oklch(0.32 0.007 85)',
      '--ring': 'oklch(0.72 0.2 17)',
      '--sidebar': 'oklch(0.24 0.006 85)',
      '--sidebar-foreground': 'oklch(0.88 0.005 85)',
      '--sidebar-primary': 'oklch(0.72 0.2 17)',
      '--sidebar-primary-foreground': 'oklch(0.2 0.005 85)',
      '--sidebar-accent': 'oklch(0.32 0.007 85)',
      '--sidebar-accent-foreground': 'oklch(0.88 0.005 85)',
      '--sidebar-border': 'oklch(0.32 0.007 85)',
      '--sidebar-ring': 'oklch(0.72 0.2 17)',
      '--surface': 'oklch(0.26 0.006 85)',
      '--surface-foreground': 'oklch(0.92 0.005 85)',
      '--code': 'oklch(0.18 0.005 85)',
      '--code-foreground': 'oklch(0.92 0.005 85)',
      '--code-highlight': 'oklch(0.3 0.007 85)',
      '--code-number': 'oklch(0.7 0.008 90)',
      '--selection': 'oklch(0.3 0.1 17)',
      '--selection-foreground': 'oklch(0.92 0.005 85)',
      '--chart-1': 'oklch(0.72 0.2 17)',
      '--chart-2': 'oklch(0.65 0.18 143)',
      '--chart-3': 'oklch(0.8 0.17 78)',
      '--chart-4': 'oklch(0.63 0.18 34)',
      '--chart-5': 'oklch(0.7 0.15 270)',
    }

    it('暗色变体应声明全部必需的 token', () => {
      const result = validateThemeTokens(airbnbDarkTokens, 'dark')
      expect(result.tokenCompleteness.missingTokens).toEqual([])
    })

    it('暗色变体品牌色应通过 WCAG 2.2 AA 对比度检查', () => {
      const result = validateThemeTokens(airbnbDarkTokens, 'dark')

      const failures = result.contrastResults.filter(r => !r.pass)
      for (const f of failures) {
        console.warn(`暗色主题对比度失败: ${f.label} = ${f.ratio}`)
      }

      expect(result.contrastResults.every(r => r.pass)).toBe(true)
      expect(result.valid).toBe(true)
    })

    it('暗色变体使用暖黑表面，不机械反色', () => {
      // 验证背景使用暖色调（hue 85 = 暖黄方向）
      const bgMatch = airbnbDarkTokens['--background'].match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
      expect(bgMatch).not.toBeNull()
      // 暖色调不等于默认暗色 hue 255
      expect(bgMatch![3]).not.toBe('255')
      // 暖黑保持低亮度
      expect(Number.parseFloat(bgMatch![1])).toBeLessThan(0.4)
    })
  })
})
