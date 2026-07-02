import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const workspacePackage = (name: string) => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  alias: {
    '@ant-chat/backend': workspacePackage('backend'),
    '@ant-chat/shared': workspacePackage('shared'),
  },
  entry: {
    cli: 'src/cli.ts',
    index: 'src/index.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  inlineOnly: false,
  sourcemap: true,
  clean: true,
  external: ['better-sqlite3', 'keytar'],
  noExternal: [/^@ant-chat\//],
})
