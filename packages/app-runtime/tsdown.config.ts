import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@ant-chat/agent-core',
    '@ant-chat/agent-runtime',
    '@ant-chat/app-data',
    '@ant-chat/mcp-client-hub',
    '@ant-chat/shared',
    'better-sqlite3',
  ],
})
