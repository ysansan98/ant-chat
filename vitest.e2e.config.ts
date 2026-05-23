import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: [
      'apps/desktop/tests/e2e/**/*.spec.ts',
    ],
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
  },
})
