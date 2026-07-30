/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
export default {
  'apps/desktop/src/**/*.ts?(x)': () => 'tsc -p apps/desktop/tsconfig.json --noEmit',
  'apps/desktop/src/**/*.{ts,js,jsx,tsx}': 'eslint --fix --quiet',
  'apps/web/src/**/*.{ts,js,jsx,tsx}': 'eslint --fix --quiet',
  'packages/**/*.{ts,js,jsx,tsx}': 'eslint --fix --quiet',
}
