import { resolve } from 'node:path'
import process from 'node:process'

import { codeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { analyzer } from 'vite-bundle-analyzer'

import { createWebRendererViteConfig } from '../web/vite.shared'

export default defineConfig(({ command, mode }) => {
  const isDev = command === 'serve'
  const webRoot = resolve('../web')

  const visualizerPlugin = (type: 'renderer' | 'main') => {
    return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [analyzer({ reportTitle: `${type} process` })] : []
  }

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
        conditions: isDev ? ['development'] : [],
        extraPlugins: command === 'build'
          ? visualizerPlugin('renderer')
          : [codeInspectorPlugin({ bundler: 'vite' })],
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
