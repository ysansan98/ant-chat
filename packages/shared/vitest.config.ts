import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/interfaces/__tests__/**/*.spec.{ts,tsx}'],
    globals: true,
  },
})
