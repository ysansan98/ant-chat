import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
  ],
  test: {
    include: [
      'apps/desktop/src/**/*.spec.{ts,tsx}',
      'apps/desktop/src/**/*.test.{ts,tsx}',
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
      '@': fileURLToPath(new URL('./apps/desktop/src/renderer/src', import.meta.url)),
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
