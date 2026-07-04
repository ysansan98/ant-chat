import type { AppearanceSettingsState } from '@ant-chat/shared'
/**
 * @vitest-environment jsdom
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  applyThemeToDocument,
  cacheAppearance,
  clearCachedAppearance,
  getCachedAppearance,
  isKnownThemeId,
  resolveEffectiveDarkMode,
  resolveEffectiveThemeId,
} from '@/utils/themeEngine'

describe('themeEngine', () => {
  beforeEach(() => {
    // 清除 localStorage 和 DOM class
    localStorage.clear()
    document.documentElement.classList.remove('dark')
    document.documentElement.removeAttribute('data-theme')
    document.documentElement.style.colorScheme = ''
  })

  describe('resolveEffectiveDarkMode', () => {
    it('light 模式返回 false', () => {
      expect(resolveEffectiveDarkMode({ mode: 'light', lightThemeId: 'default', darkThemeId: 'default' })).toBe(false)
    })

    it('dark 模式返回 true', () => {
      expect(resolveEffectiveDarkMode({ mode: 'dark', lightThemeId: 'default', darkThemeId: 'default' })).toBe(true)
    })
  })

  describe('resolveEffectiveThemeId', () => {
    it('light 模式返回 lightThemeId', () => {
      expect(resolveEffectiveThemeId({ mode: 'light', lightThemeId: 'default', darkThemeId: 'default' })).toBe('default')
    })

    it('dark 模式返回 darkThemeId', () => {
      expect(resolveEffectiveThemeId({ mode: 'dark', lightThemeId: 'default', darkThemeId: 'default' })).toBe('default')
    })
  })

  describe('isKnownThemeId', () => {
    it('default 是已知主题', () => {
      expect(isKnownThemeId('default')).toBe(true)
    })

    it('airbnb 是已知主题', () => {
      expect(isKnownThemeId('airbnb')).toBe(true)
    })

    it('未知主题 ID 返回 false', () => {
      expect(isKnownThemeId('unknown-theme')).toBe(false)
    })
  })

  describe('applyThemeToDocument', () => {
    it('亮色模式应移除 dark class 并设置 light color-scheme', () => {
      applyThemeToDocument({ mode: 'light', lightThemeId: 'default', darkThemeId: 'default' })
      expect(document.documentElement.classList.contains('dark')).toBe(false)
      expect(document.documentElement.getAttribute('data-theme')).toBe('default')
      expect(document.documentElement.style.colorScheme).toBe('light')
    })

    it('暗色模式应添加 dark class 并设置 dark color-scheme', () => {
      applyThemeToDocument({ mode: 'dark', lightThemeId: 'default', darkThemeId: 'default' })
      expect(document.documentElement.classList.contains('dark')).toBe(true)
      expect(document.documentElement.getAttribute('data-theme')).toBe('default')
      expect(document.documentElement.style.colorScheme).toBe('dark')
    })

    it('未知主题 ID 应降级为 default', () => {
      applyThemeToDocument({ mode: 'light', lightThemeId: 'unknown-theme', darkThemeId: 'default' })
      expect(document.documentElement.getAttribute('data-theme')).toBe('default')
    })
  })

  describe('cacheAppearance / getCachedAppearance', () => {
    it('应持久化和读取外观配置', () => {
      const appearance: AppearanceSettingsState = { mode: 'dark', lightThemeId: 'default', darkThemeId: 'default' }
      cacheAppearance(appearance)
      expect(getCachedAppearance()).toEqual(appearance)
    })

    it('应能清除缓存', () => {
      const appearance: AppearanceSettingsState = { mode: 'system', lightThemeId: 'default', darkThemeId: 'default' }
      cacheAppearance(appearance)
      clearCachedAppearance()
      expect(getCachedAppearance()).toBeNull()
    })

    it('缓存不可用时返回 null', () => {
      expect(getCachedAppearance()).toBeNull()
    })
  })
})
