import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vite'
import { createWebRendererViteConfig } from './vite.shared'

const rootDir = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ command, mode }) => {
  return {
    ...createWebRendererViteConfig({
      command,
      mode,
      conditions: ['development'],
      runtime: 'web',
      rootDir,
    }),
    server: {
      host: '127.0.0.1',
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:3456',
          changeOrigin: true,
        },
      },
    },
  }
})
