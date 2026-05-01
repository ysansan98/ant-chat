import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: [
      'tests/e2e/**/*.spec.ts',
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
      './tests/setup.ts',
    ],
  },
})
