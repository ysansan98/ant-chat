import type { PluginOption, UserConfig } from 'vite'

import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'

interface AliasEntry {
  find: string | RegExp
  replacement: string
}

interface WebRendererViteConfigOptions {
  conditions: string[]
  extraAliases?: AliasEntry[]
  extraPlugins?: PluginOption[]
  runtime: 'electron' | 'web'
  rootDir: string
}

export function createWebRendererViteConfig({
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
      ...extraPlugins,
    ],
    worker: {
      format: 'es',
    },
  }
}
