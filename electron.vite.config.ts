import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import svgr from 'vite-plugin-svgr'

export default defineConfig(({ command, mode }) => {
  const isDev = command === 'serve'

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
        sourcemap: isDev ? 'inline' : false,
        rollupOptions: {
          external: ['better-sqlite3'],
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
          },
        },
      },
    },
    preload: {
      build: {
        minify: !isDev,
        sourcemap: isDev ? 'inline' : false,
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
          ? []
          : [codeInspectorPlugin({ bundler: 'vite' })]),
      ],
      build: {
        minify: !isDev,
        sourcemap: isDev ? 'inline' : false,
      },
    },
  }
})
