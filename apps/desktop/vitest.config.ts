import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/main/**/*.spec.{ts,tsx}'],
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    alias: {
      '@main': fileURLToPath(new URL('./src/main', import.meta.url)),
    },
  },
})
