import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import antfu from '@antfu/eslint-config'
import tailwindcss from 'eslint-plugin-better-tailwindcss'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default antfu(
  {
    pnpm: true,
    react: true,
    typescript: true,
    formatters: {
      css: true,
      html: true,
      markdown: 'prettier',
    },
    ignores: [
      'docs/**/*.md',
      'docs/**/*.html',
      'plans/**',
      '*.md',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      '**/*.db',
      '.ant-chat/**',
      'apps/desktop/.ant-chat/**',
      '.claude/**',
      '.agents/**',
      '.superpowers/**',
    ],
    rules: {
      'no-console': ['off'],
      'ts/no-redeclare': ['off'],
      'react/no-implicit-key': ['off'],
    },
  },
  {
    files: [
      'packages/ui/src/**/*.{ts,tsx}',
      'apps/desktop/src/**/*.{ts,tsx}',
      'apps/web/src/**/*.{ts,tsx}',
    ],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      'better-tailwindcss': tailwindcss,
    },
    rules: {
      // 启用推荐规则
      ...tailwindcss.configs['recommended-warn'].rules,
      ...tailwindcss.configs['recommended-error'].rules,

      // 关闭换行规则，看着不舒服
      'better-tailwindcss/enforce-consistent-line-wrapping': 'off',

      // 忽略自定义 class 白名单
      'better-tailwindcss/no-unknown-classes': [
        'warn',
        {
          detectComponentClasses: true,
          ignore: [
            'antd-css-var',
            'ant-.*',
            'mermaid-container',
            'app-region-drag',
            'app-region-no-drag',
            'inputs', // cn() 参数名误识别
            'toaster', // sonner toast
            'sender-primary-action',
            'scrollbar-thin',
            'scroll-hidden',
            'desktop-sidebar-shell',
            'font-message',
            'model-control-settings',
            'model-control-trigger',
            'pending-message-scroll',
            'pending-message-enter',
            'is-user',
            'is-user:.*',
            'is-assistant',
          ],
        },
      ],

      'ts/no-require-imports': ['off'],
      'node/prefer-global/process': ['off'],
    },
    settings: {
      'better-tailwindcss': {
        cwd: resolve(__dirname, 'packages/ui'),
        entryPoint: 'src/styles/globals.css',
        rootFontSize: 16,
      },
    },
  },
  {
    files: ['packages/**/*.{spec,test}.{ts,tsx}'],
    rules: {
      'import/order': ['off'],
      'perfectionist/sort-imports': ['off'],
    },
  },
  {
    files: ['packages/ui/src/components/ai-elements/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/static-components': 'off',
      'react/static-components': 'off',
      'react/no-children-count': 'off',
      'react-hooks-extra/no-direct-set-state-in-use-effect': 'off',
      'regexp/no-super-linear-backtracking': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
  {
    // shadcn/ui 组件常导出 variant 对象，是标准模式
    files: ['packages/ui/src/components/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // React Context 文件通常同时导出 Provider 组件和 consumer hook
    files: ['apps/web/src/contexts/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['**/package.json', 'pnpm-workspace.yaml'],
    rules: {
      'pnpm/yaml-enforce-settings': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
)
