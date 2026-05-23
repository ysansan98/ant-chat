import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
  ],
  test: {
    include: [
      'src/**/*.spec.{ts,tsx}',
      'src/**/*.test.{ts,tsx}',
      'packages/**/*.spec.{ts,tsx}',
      'packages/**/*.test.{ts,tsx}',
      'tests/**/*.spec.{ts,tsx}',
      'tests/**/*.test.{ts,tsx}',
    ],
    coverage: {
      provider: 'v8',
      include: [
        'src/main/**/*.test.{ts,tsx}',
      ],
      exclude: [
        'src/**/*.d.ts',
        'src/**/interface.ts',
        'src/types/**',
      ],
    },
    globals: true,
    alias: {
      '@ant-chat/shared': fileURLToPath(new URL('./packages/shared/src/index.ts', import.meta.url)),
      '@ant-chat/app-data': fileURLToPath(new URL('./packages/app-data/src/index.ts', import.meta.url)),
      '@ant-chat/local-server': fileURLToPath(new URL('./packages/local-server/src/index.ts', import.meta.url)),
      '@ant-design/x/es/sender/useSpeech': '@ant-design/x/es/sender/useSpeech',
      '@ant-design/x': '@ant-design/x/es',
      '@': fileURLToPath(new URL('./src/renderer/src', import.meta.url)),
      '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
    },
    environment: 'jsdom',
    setupFiles: [
      './tests/setup.common.ts',
    ],
    exclude: [
      'tests/e2e/**',
      'tests/ui/**',
      'node_modules/**',
      '**/node_modules/**',
    ],
  },
})
