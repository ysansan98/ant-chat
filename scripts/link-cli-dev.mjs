#!/usr/bin/env node
// scripts/link-cli-dev.mjs - 开发环境创建 ant-chat CLI 链接
import { chmodSync, existsSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const link = resolve(root, 'node_modules/.bin/ant-chat')

// Node.js wrapper，通过 tsx 运行 TypeScript 源码，无 shell 依赖
const wrapper = [
  '#!/usr/bin/env node',
  'import { spawnSync } from "node:child_process"',
  'import { fileURLToPath } from "node:url"',
  'import p from "node:path"',
  '',
  'const __dirname = p.dirname(fileURLToPath(import.meta.url))',
  'const cwd = p.resolve(__dirname, "../..")',
  'const entry = p.resolve(__dirname, "../../packages/cli/src/index.ts")',
  'const result = spawnSync(',
  '  process.execPath,',
  '  ["--conditions=development", "--import", "tsx", entry, ...process.argv.slice(2)],',
  '  { stdio: "inherit", cwd },',
  ')',
  'process.exit(result.status ?? 1)',
  '',
].join('\n')

if (existsSync(link)) {
  try {
    unlinkSync(link)
  }
  catch {
    // 忽略
  }
}

writeFileSync(link, wrapper, { mode: 0o755 })
chmodSync(link, 0o755)
console.info('[link-cli-dev] 已创建 ant-chat CLI 开发入口 →', link)
