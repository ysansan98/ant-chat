import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
  ],
  test: {
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
