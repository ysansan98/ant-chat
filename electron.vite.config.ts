import { resolve } from 'node:path'
import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { analyzer } from 'vite-bundle-analyzer'
import svgr from 'vite-plugin-svgr'

export default defineConfig(({ command, mode }) => {
  const isDev = command === 'serve'

  const visualizerPlugin = (type: 'renderer' | 'main') => {
    return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [analyzer({ reportTitle: `${type} process` })] : []
  }

  console.info('command: ', command, 'mode: ', mode)
  return {
    main: {
      resolve: {
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
      resolve: {
        alias: {
          '@': resolve('src/renderer/src'),
        },
      },
      plugins: [
        react({
          babel: {
            plugins: [
              ['babel-plugin-react-compiler', {}],
            ],
          },
        }),
        tailwindcss(),
        svgr({
          svgrOptions: { icon: true },
        }),
        ...(command === 'build'
          ? visualizerPlugin('renderer')
          : [codeInspectorPlugin({ bundler: 'vite' })]),
      ],
      build: {
        minify: !isDev,
        sourcemap: !!isDev,
      },
    },
  }
})
