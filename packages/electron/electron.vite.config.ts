import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { analyzer } from 'vite-bundle-analyzer'
import svgr from 'vite-plugin-svgr'

export default defineConfig(({ command, mode }) => {
  console.info('command: ', command, 'mode: ', mode)
  return {
    main: {
      resolve: {
        alias: {
          '@main': resolve('src/main'),
        },
      },
      build: {
        sourcemap: true,
        rollupOptions: {
          output: {
            format: 'cjs',
            entryFileNames: '[name].cjs',
          },
        },
      },
    },
    preload: {},
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
        analyzer(),
      ],
    },
  }
})
