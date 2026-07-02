import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    'index': 'src/index.ts',
    'rpc-handlers': 'src/rpcHandlers.ts',
  },
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: true,
  clean: true,
  external: [
    '@ant-chat/shared',
    'better-sqlite3',
    'electron',
    'undici',
  ],
})
