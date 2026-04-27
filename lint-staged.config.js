/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
  'src/**/*.ts?(x)': () => 'tsc -p tsconfig.json --noEmit',
  'packages/**/*.{ts,js,jsx,tsx,vue}': 'eslint --fix --quiet',
  'src/**/*.{ts,js,jsx,tsx}': 'eslint --fix --quiet',
}
