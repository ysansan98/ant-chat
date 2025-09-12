/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
  'packages/electron/**/*.ts?(x)': () => 'tsc -p packages/electron/tsconfig.json --noEmit',
  'packages/**/*.{ts,js,jsx,tsx,vue}': 'eslint --fix --quiet',
}
