import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'

interface ThemeStore {
  mode: 'auto' | 'dark' | 'light'
  theme: 'dark' | 'light'
  toggleTheme: (theme?: ThemeStore['theme']) => void
  setThemeMode: (mode: ThemeStore['mode']) => void
}

export const useThemeStore = create<ThemeStore>()(
  devtools(
    persist(
      (set, get) => {
        return {
          mode: 'auto',
          theme: 'light',
          setThemeMode: (mode: ThemeStore['mode']) => {
            set({ mode })

            let theme = get().theme

            if (mode === 'auto') {
              const lightMatchMedia = window.matchMedia('(prefers-color-scheme: light)')
              theme = lightMatchMedia.matches ? 'light' : 'dark'
            }

            else {
              theme = mode
            }

            get().toggleTheme(theme)
          },
          toggleTheme: (theme) => {
            if (!theme) {
              set({ theme: get().theme === 'light' ? 'dark' : 'light' })
            }
            else {
              set({ theme })
            }
            document.documentElement.classList.toggle('dark', get().theme === 'dark')
          },
        }
      },
      {
        name: 'theme',
      },
    ),
    {
      enabled: import.meta.env.MODE === 'development',
    },
  ),
)
