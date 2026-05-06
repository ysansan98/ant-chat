import { useCallback, useMemo } from 'react'

function getCssVar(name: string) {
  if (typeof document === 'undefined')
    return ''
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

export function useTheme() {
  const token = useMemo(() => ({
    colorPrimary: getCssVar('--primary'),
    colorBgContainer: getCssVar('--background'),
    colorBgElevated: getCssVar('--popover'),
    colorText: getCssVar('--foreground'),
    colorTextSecondary: getCssVar('--muted-foreground'),
    colorBorder: getCssVar('--border'),
    borderRadius: Number.parseInt(getCssVar('--radius') || '8'),
    fontFamily: getCssVar('--font-sans'),
    fontSize: 14,
    lineHeight: 1.5,
  }), [])

  const useToken = useCallback(() => token, [token])

  return { token, useToken }
}
