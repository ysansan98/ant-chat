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
    include: [
      'apps/desktop/src/**/*.spec.{ts,tsx}',
      'apps/desktop/src/**/*.test.{ts,tsx}',
      'apps/web/src/**/*.spec.{ts,tsx}',
      'apps/web/src/**/*.test.{ts,tsx}',
      'packages/**/*.spec.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'apps/desktop/tests/**/*.spec.{ts,tsx}',
      'apps/desktop/tests/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'apps/desktop/src/main/**/*.test.{ts,tsx}',
      ],
      exclude: [
        'apps/desktop/src/**/*.d.ts',
        'apps/desktop/src/**/interface.ts',
        'apps/desktop/src/types/**',
      ],
    },
    globals: true,
    alias: {
      '@ant-design/x/es/sender/useSpeech': '@ant-design/x/es/sender/useSpeech',
      '@ant-design/x': '@ant-design/x/es',
      '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)),
      '@main': fileURLToPath(new URL('./apps/desktop/src/main', import.meta.url)),
    },
    environment: 'jsdom',
    setupFiles: [
      './apps/desktop/tests/setup.common.ts',
    ],
    exclude: [
      'apps/desktop/tests/e2e/**',
      'apps/desktop/tests/ui/**',
      'node_modules/**',
      '**/node_modules/**',
    ],
  },
})
