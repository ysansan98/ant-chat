import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const workspacePackage = (name: string) => fileURLToPath(new URL(`../${name}/src/index.ts`, import.meta.url))

export default defineConfig({
  alias: {
    '@ant-chat/agent-core': workspacePackage('agent-core'),
    '@ant-chat/agent-runtime': workspacePackage('agent-runtime'),
    '@ant-chat/app-data': workspacePackage('app-data'),
    '@ant-chat/app-runtime': workspacePackage('app-runtime'),
    '@ant-chat/mcp-client-hub': workspacePackage('mcp-client-hub'),
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
  external: ['better-sqlite3'],
  noExternal: [/^@ant-chat\//],
})
