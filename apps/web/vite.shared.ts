import type { PluginOption, UserConfig } from 'vite'
import { resolve } from 'node:path'

import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { codeInspectorPlugin } from 'code-inspector-plugin'
import { analyzer } from 'vite-bundle-analyzer'
import svgr from 'vite-plugin-svgr'

interface AliasEntry {
  find: string | RegExp
  replacement: string
}

interface WebRendererViteConfigOptions {
  command: 'build' | 'serve'
  mode: string
  conditions: string[]
  extraAliases?: AliasEntry[]
  extraPlugins?: PluginOption[]
  runtime: 'electron' | 'web'
  rootDir: string
}

export function createWebRendererViteConfig({
  command,
  conditions,
  extraAliases = [],
  extraPlugins = [],
  runtime,
  rootDir,
}: WebRendererViteConfigOptions): UserConfig {
  return {
    define: {
      __APP_RUNTIME__: JSON.stringify(runtime),
    },
    resolve: {
      conditions,
      alias: [
        { find: /^shiki\/engine\/javascript$/, replacement: resolve(rootDir, '../../packages/ui/src/lib/shiki-engine-shim.ts') },
        { find: /^shiki$/, replacement: resolve(rootDir, '../../packages/ui/src/lib/shiki-shim.ts') },
        { find: '@', replacement: resolve(rootDir, 'src') },
        ...extraAliases,
      ],
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

      command === 'build'
        ? visualizerPlugin('renderer')
        : codeInspectorPlugin({ bundler: 'vite' }),
      ...extraPlugins,
    ],
    worker: {
      format: 'es',
    },
  }
}

export function visualizerPlugin(type: 'renderer' | 'main') {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [analyzer({ reportTitle: `${type} process` })] : []
}
