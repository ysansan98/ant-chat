import antfu from '@antfu/eslint-config'
import eslintPluginBetterTailwindcss from 'eslint-plugin-better-tailwindcss'

export default antfu(
  {
    react: true,
    typescript: true,
    formatters: {
      css: true,
      html: true,
      markdown: 'prettier',
    },
    rules: {
      'no-console': ['off'],
      'ts/no-redeclare': ['off'],
    },
  },
  {
    files: ['packages/**/*.{ts,tsx}'],
  },
  {
    files: ['packages/electron/**/*.{ts,tsx}'],
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
      'better-tailwindcss/enforce-consistent-line-wrapping': ['warn', { printWidth: 100 }],
      'better-tailwindcss/no-unregistered-classes': ['error', {
        ignore: [
          'app-region-drag',
          'ant-*',
          'antd-*',
          'icon-*',
          'mermaid-container',
        ],
      }],
      'ts/no-require-imports': ['off'],
      'node/prefer-global/process': ['off'],
    },
    settings: {
      entryPoint: './packages/electron/src/renderer/src/index.css',
    },
  },
  {
    files: ['packages/**/*.{spec,test}.{ts,tsx}'],
    rules: {
      'import/order': ['off'],
      'perfectionist/sort-imports': ['off'],
    },
  },
)
