import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import antfu from '@antfu/eslint-config'
import eslintPluginBetterTailwindcss from 'eslint-plugin-better-tailwindcss'

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
      '*.md',
      '**/out/**',
      '**/dist/**',
      '**/release/**',
      '**/*.db',
      '.ant-chat/**',
      'apps/desktop/.ant-chat/**',
      '.claude/**',
      '.agents/**',
    ],
    rules: {
      'no-console': ['off'],
      'ts/no-redeclare': ['off'],
      'react/no-implicit-key': ['off'],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
  },
  {
    files: ['apps/desktop/src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    plugins: {
      'better-tailwindcss': eslintPluginBetterTailwindcss,
    },
    rules: {
      // enable all recommended rules to report a warning
      ...eslintPluginBetterTailwindcss.configs['recommended-warn'].rules,
      // enable all recommended rules to report an error
      ...eslintPluginBetterTailwindcss.configs['recommended-error'].rules,

      // or configure rules individually
      'better-tailwindcss/enforce-consistent-line-wrapping': [
        'warn',
        { printWidth: 100 },
      ],
      'better-tailwindcss/no-unknown-classes': [
        'warn',
        {
          detectComponentClasses: true,
          ignore: [
            'antd-css-var',
            'ant-*',
            'mermaid-container',
            'app-region-drag',
            'app-region-no-drag',
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
      'react-hooks-extra/no-direct-set-state-in-use-effect': 'off',
      'regexp/no-super-linear-backtracking': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
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
