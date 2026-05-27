import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  esbuild: {
    jsx: 'automatic',
    jsxInject: `import React from 'react'`,
  },
  plugins: [
    react(),
  ],
  test: {
    globals: true,
    include: [
      'apps/desktop/tests/ui/**/*.spec.{ts,tsx}',
    ],
    alias: {
      '@ant-design/x/es/sender/useSpeech': '@ant-design/x/es/sender/useSpeech',
      '@ant-design/x': '@ant-design/x/es',
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
      '@main': fileURLToPath(new URL('./apps/desktop/src/main', import.meta.url)),
    },
    environment: 'jsdom',
    setupFiles: [
      './apps/desktop/tests/setup.ui.ts',
    ],
  },
})
