#!/usr/bin/env node
// scripts/link-cli-dev.mjs - 开发环境创建 ant-chat CLI 链接
import { chmodSync, existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(import.meta.url), '../..')
const repoLink = resolve(root, 'node_modules/.bin/ant-chat')
// 用户 PATH 内的 bin 目录：让 ant-chat 在任何 cwd 可用（含 agent execute_command）。
// pnpm dev 从终端启动时 desktop 主进程继承终端 PATH，agent 的 execute_command
// 才能找到该链接；只写仓库 node_modules/.bin 时从任意 workspace 目录调用会
// 因命令不在 PATH 失败（或退化为 pnpm exec 触发 verifyDepsBeforeRun 自动 install）。
const userLink = resolve(os.homedir(), '.local/bin/ant-chat')

// Node.js wrapper，通过 tsx 运行 TypeScript 源码，无 shell 依赖
const wrapper = [
  '#!/usr/bin/env node',
  'import { spawnSync } from "node:child_process"',
  'import { createRequire } from "node:module"',
  'import p from "node:path"',
  'import { pathToFileURL } from "node:url"',
  '',
  `// 仓库根在链接生成时固化，避免 wrapper 被链接到仓库外（如 ~/.local/bin）后路径推断失效`,
  `const root = ${JSON.stringify(root)}`,
  // tsx 是 ant-chat 包的 devDependency（pnpm 未 hoist 到仓库根），用包解析拿
  // loader 绝对路径再喂给 --import，避免依赖 cwd 解析裸包名（否则 cwd 必须指向包目录）。
  'const requireFromPackage = createRequire(p.resolve(root, "packages/ant-chat/package.json"))',
  'const tsxLoader = pathToFileURL(requireFromPackage.resolve("tsx")).href',
  'const tsconfigPath = p.resolve(root, "packages/ant-chat/tsconfig.json")',
  'const entry = p.resolve(root, "packages/ant-chat/src/cli.ts")',
  'const result = spawnSync(',
  '  process.execPath,',
  '  ["--conditions=development", "--import", tsxLoader, entry, ...process.argv.slice(2)],',
  '  {',
  '    stdio: "inherit",',
  // cwd 保持调用者目录：CLI 的相对路径参数（如 image generate --output ./generated）
  // 必须相对调用者解析；tsconfig 显式传包内配置，与 cwd=包目录时的默认行为一致。
  '    env: { ...process.env, TSX_TSCONFIG_PATH: tsconfigPath },',
  '  },',
  ')',
  'process.exit(result.status ?? 1)',
  '',
].join('\n')

function installLink(link) {
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
}

installLink(repoLink)
// 用户 bin 目录不存在时创建；写入失败（如只读目录）不阻断仓库链接。
try {
  mkdirSync(resolve(os.homedir(), '.local/bin'), { recursive: true })
  installLink(userLink)
}
catch {
  console.warn('[link-cli-dev] 创建用户级链接失败，ant-chat 仅仓库内可用：', userLink)
}
