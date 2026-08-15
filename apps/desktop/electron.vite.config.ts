import fs from 'node:fs/promises'
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
          external: ['better-sqlite3', 'keytar'],
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
          },

        },
      },
      plugins: [
        ...visualizerPlugin('main'),
        {
          name: 'copy-builtin-skills',
          async closeBundle() {
            // dev 时 backend 从源码解析（development 条件），dist 可能尚未构建；
            // 打包构建依赖 build:packages 产出的 dist，保持与 npm 产物一致。
            const skillsSource = isDev
              ? resolve('../../packages/backend/builtin-skills')
              : resolve('../../packages/backend/dist/builtin-skills')
            await fs.cp(
              skillsSource,
              resolve('out/main/builtin-skills'),
              { recursive: true },
            )
          },
        },
      ],
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
