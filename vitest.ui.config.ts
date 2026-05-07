import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    react(),
  ],
  test: {
    globals: true,
    include: [
      'tests/ui/**/*.spec.{ts,tsx}',
    ],
    alias: {
      '@ant-chat/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@ant-design/x/es/sender/useSpeech': '@ant-design/x/es/sender/useSpeech',
      '@ant-design/x': '@ant-design/x/es',
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
    },
    environment: 'jsdom',
    setupFiles: [
      './tests/setup.ui.ts',
    ],
  },
})
