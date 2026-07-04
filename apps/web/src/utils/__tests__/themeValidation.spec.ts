import { describe, expect, it } from 'vitest'
import {
  calculateContrastRatio,
  REQUIRED_THEME_TOKENS,
  validateThemeTokens,
} from '@/utils/themeValidation'

describe('themeValidation', () => {
  describe('rEQUIRED_THEME_TOKENS', () => {
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
})
