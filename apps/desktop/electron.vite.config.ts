import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

import { createWebRendererViteConfig, visualizerPlugin } from '../web/vite.shared'

export default defineConfig(({ command, mode }) => {
  const isDev = command === 'serve'
  const webRoot = resolve('../web')

  console.info('command: ', command, 'mode: ', mode)
  return {
    main: {
      resolve: {
        conditions: isDev ? ['development'] : [],
        alias: {
          '@main': resolve('src/main'),
        },
      },
      build: {
        minify: !isDev,
        sourcemap: !!isDev,
        rollupOptions: {
          external: ['better-sqlite3'],
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
          },

        },
      },
      plugins: visualizerPlugin('main'),
    },
    preload: {
      build: {
        minify: !isDev,
        sourcemap: !!isDev,
      },
    },
    renderer: {
      ...createWebRendererViteConfig({
        command,
        mode,
        conditions: isDev ? ['development'] : [],
        runtime: 'electron',
        rootDir: webRoot,
      }),
      root: webRoot,
      build: {
        minify: !isDev,
        sourcemap: !!isDev,
        outDir: resolve('out/renderer'),
        rollupOptions: {
          input: resolve('../web/index.html'),
        },
      },
    },
  }
})
