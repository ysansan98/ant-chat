import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const workspacePackage = (name: string) => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url))

const packageVersion = (JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }).version

export default defineConfig({
  alias: {
    '@ant-chat/backend': workspacePackage('backend'),
    '@ant-chat/control-client': workspacePackage('control-client'),
    '@ant-chat/shared': workspacePackage('shared'),
  },
  define: {
    __ANT_CHAT_VERSION__: JSON.stringify(packageVersion),
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
  external: ['better-sqlite3', 'keytar', '@larksuiteoapi/node-sdk'],
  noExternal: [/^@ant-chat\//],
})
