import type { PluginOption, UserConfig } from 'vite'
import { resolve } from 'node:path'

import process from 'node:process'
import tailwindcss from '@tailwindcss/vite'
import reactSwc from '@vitejs/plugin-react-swc'
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
        // wasm-bindgen glue code 从 Node 内置模块导入，浏览器环境需 shim
        { find: 'util', replacement: resolve(rootDir, 'src/lib/util-shim.ts') },
        { find: 'async_hooks', replacement: resolve(rootDir, 'src/lib/util-shim.ts') },
        { find: /^shiki\/engine\/javascript$/, replacement: resolve(rootDir, '../../packages/ui/src/lib/shiki-engine-shim.ts') },
        { find: /^shiki$/, replacement: resolve(rootDir, '../../packages/ui/src/lib/shiki-shim.ts') },
        { find: '@', replacement: resolve(rootDir, 'src') },
        ...extraAliases,
      ],
    },
    plugins: [
      command === 'build'
        ? visualizerPlugin('renderer')
        : codeInspectorPlugin({ bundler: 'vite' }),
      ...extraPlugins,
      // 统一使用 SWC 原生转换 + SWC 版 React Compiler（Rust 实现，毫秒级，
      // 同时保留 memo 优化），dev 冷启动与生产构建共用一条工具链
      reactSwc({
        useAtYourOwnRisk_mutateSwcOptions: (options) => {
          options.jsc.transform.reactCompiler = true
        },
      }),
      tailwindcss(),
      svgr({
        svgrOptions: { icon: true },
      }),
    ],
    worker: {
      format: 'es',
    },
    // dev server 启动时预热首屏模块，让 babel+react-compiler 的 transform
    // 在窗口加载前开始执行，缩短首次白屏
    server: {
      warmup: {
        clientFiles: ['./src/main.tsx'],
      },
    },
    // 预构建 workspace 包：monorepo 链接包默认被 Vite 当源码逐个 transform，
    // 白屏 4 秒主要花在这（113 个模块排队编译）。
    // @workspace/ui 消费方使用子路径导入（无根入口），而 Vite 对 workspace 包的
    // deep import 重写只做精确匹配（src 相对路径导致前缀匹配失效），
    // 因此必须逐个子路径列出；新增 ui 模块导入后未列出的会走源码 transform，
    // 并在首次访问时触发 Vite 自动补充预构建（有兜底，仅慢一次）。
    optimizeDeps: {
      // Vite 默认只允许 .js/.ts 入口参与预构建，.tsx/.jsx 需显式声明
      extensions: ['.tsx', '.jsx'],
      include: [
        '@ant-chat/shared',
        '@workspace/ui/components/ai-elements/attachments',
        '@workspace/ui/components/ai-elements/code-block',
        '@workspace/ui/components/ai-elements/markdown',
        '@workspace/ui/components/ai-elements/message',
        '@workspace/ui/components/ai-elements/prompt-input',
        '@workspace/ui/components/ai-elements/shimmer',
        '@workspace/ui/components/alert',
        '@workspace/ui/components/alert-dialog',
        '@workspace/ui/components/avatar',
        '@workspace/ui/components/badge',
        '@workspace/ui/components/button',
        '@workspace/ui/components/card',
        '@workspace/ui/components/checkbox',
        '@workspace/ui/components/collapsible',
        '@workspace/ui/components/command',
        '@workspace/ui/components/context-usage',
        '@workspace/ui/components/dialog',
        '@workspace/ui/components/dropdown-menu',
        '@workspace/ui/components/empty-state',
        '@workspace/ui/components/field',
        '@workspace/ui/components/input',
        '@workspace/ui/components/input-group',
        '@workspace/ui/components/input-number',
        '@workspace/ui/components/label',
        '@workspace/ui/components/popover',
        '@workspace/ui/components/progress',
        '@workspace/ui/components/radio-group',
        '@workspace/ui/components/scroll-area',
        '@workspace/ui/components/select',
        '@workspace/ui/components/separator',
        '@workspace/ui/components/sheet',
        '@workspace/ui/components/skeleton',
        '@workspace/ui/components/slider',
        '@workspace/ui/components/sonner',
        '@workspace/ui/components/spinner',
        '@workspace/ui/components/switch',
        '@workspace/ui/components/tabs',
        '@workspace/ui/components/textarea',
        '@workspace/ui/components/tooltip',
        '@workspace/ui/hooks/use-theme',
        '@workspace/ui/lib/clipboard',
        '@workspace/ui/lib/utils',
        // 预览库：含 WASM glue code，需预构建以正确解析依赖
        '@extend-ai/react-xlsx',
        '@extend-ai/react-docx',
        '@embedpdf/react-pdf-viewer',
      ],
      // Vite 8 用 Rolldown 预构建依赖；Node 内置模块在浏览器环境需 shim
      // （wasm-bindgen glue code 引用 util / async_hooks）
      // 注意：rolldown 的 alias 属于 resolve 子选项（顶层 alias 仅旧版本支持）
      rolldownOptions: {
        resolve: {
          alias: {
            util: resolve(rootDir, 'src/lib/util-shim.ts'),
            async_hooks: resolve(rootDir, 'src/lib/util-shim.ts'),
          },
        },
      },
    },
  }
}

export function visualizerPlugin(type: 'renderer' | 'main') {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [analyzer({ reportTitle: `${type} process` })] : []
}
