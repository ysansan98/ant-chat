#!/usr/bin/env node
/**
 * scripts/native-abi.mjs - Node/Electron 双 ABI 原生产物缓存与同步
 *
 * 背景：better-sqlite3 是纯 V8-ABI 模块（binding.gyp 无 napi），Node（ABI 137）
 * 与 Electron（ABI 143）必须使用各自编译的产物；keytar 虽是 N-API（双端通用），
 * electron-rebuild 也会重编译它。此前两种产物共用一个 build/Release 位置，
 * 每次切换运行时都要重新编译（rebuild:node / rebuild:electron 互斥）。
 *
 * 方案：每种运行时各编译一次，产物归档到 ~/.cache/ant-chat-native/，
 * 之后切换只做文件拷贝（毫秒级），不再触发 node-gyp 编译。
 *
 * 用法：
 *   node scripts/native-abi.mjs --sync [node|electron]   同步产物（缺省按当前运行时）
 *   node scripts/native-abi.mjs --build node|electron|all  编译指定运行时并写缓存
 *
 * 接线：pnpm postinstall / test:unit 前置 sync node；desktop predev/prestart sync electron。
 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CACHE_ROOT = path.join(os.homedir(), '.cache', 'ant-chat-native')

/** 需要双 ABI 管理的原生模块：产物文件名 + build/Release 子目录 */
const MODULES = [
  { name: 'better-sqlite3', file: 'better_sqlite3.node' },
  { name: 'keytar', file: 'keytar.node' },
]

function parseArgs() {
  const argv = process.argv.slice(2)
  const build = []
  let sync
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--build') {
      const value = argv[++i]
      if (value === 'all')
        build.push('node', 'electron')
      else if (value === 'node' || value === 'electron')
        build.push(value)
      else
        throw new Error(`未知 build 目标：${value}`)
    }
    else if (argv[i] === '--sync') {
      const value = argv[++i]
      if (value !== undefined && value !== 'node' && value !== 'electron')
        throw new Error(`未知 sync 目标：${value}`)
      sync = value
    }
    else {
      throw new Error(`未知参数：${argv[i]}。用法：--build node|electron|all | --sync [node|electron]`)
    }
  }
  return { build, sync }
}

function currentRuntime() {
  return process.versions.electron ? 'electron' : 'node'
}

/** Electron 主版本决定 ABI；Node 用 process.versions.modules 的 ABI 号。 */
function runtimeTag(runtime) {
  if (runtime === 'electron') {
    const pkgPath = path.join(ROOT, 'apps/desktop/node_modules/electron/package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    return `electron-v${pkg.version.split('.')[0]}`
  }
  return `node-v${process.versions.modules}`
}

/** pnpm 为不同 peer 组合可能保留多个副本，统一收集所有 build/Release 目录。 */
function moduleReleaseDirs(moduleName) {
  const pnpmDir = path.join(ROOT, 'node_modules', '.pnpm')
  if (!fs.existsSync(pnpmDir))
    return []
  const dirs = []
  for (const entry of fs.readdirSync(pnpmDir)) {
    if (!entry.startsWith(`${moduleName}@`))
      continue
    const release = path.join(pnpmDir, entry, 'node_modules', moduleName, 'build', 'Release')
    if (fs.existsSync(release))
      dirs.push(release)
  }
  return dirs
}

function cacheFile(moduleName, runtime, file) {
  return path.join(CACHE_ROOT, moduleName, runtimeTag(runtime), file)
}

/**
 * 原子替换式拷贝：先写同目录临时文件再 rename。
 * 不能直接 copyFileSync 覆盖：macOS 对已加载执行过的 Mach-O 按 vnode 缓存
 * 代码签名校验状态，就地覆写会让该 inode 的签名校验失效，之后任何进程
 * 再加载同一 inode 都会在首次执行代码页时被 SIGKILL（Code Signature Invalid）。
 * rename 会换新 inode，重新走完整校验。
 */
function copyFileAtomic(source, dest) {
  const tmp = `${dest}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`
  fs.copyFileSync(source, tmp)
  // Windows 的 rename 不允许覆盖已存在目标，先删旧文件
  if (process.platform === 'win32' && fs.existsSync(dest))
    fs.rmSync(dest)
  fs.renameSync(tmp, dest)
}

function copyToDirs(source, dirs, file) {
  for (const dir of dirs) {
    copyFileAtomic(source, path.join(dir, file))
  }
}

function run(command, args, options) {
  // Windows 下 pnpm 是 .cmd 包装，需要 shell；macOS/Linux 直接执行 shebang 脚本。
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0) {
    throw new Error(`命令失败（exit ${result.status ?? 'unknown'}）：${command} ${args.join(' ')}`)
  }
}

function buildRuntime(runtime) {
  if (runtime === 'node') {
    run('pnpm', ['-r', 'rebuild', 'better-sqlite3', 'keytar'], { cwd: ROOT })
  }
  else {
    run('pnpm', ['-C', 'apps/desktop', 'exec', 'electron-rebuild', '-f', '-w', 'better-sqlite3,keytar'], { cwd: ROOT })
  }

  // 编译结果统一到所有副本，并按运行时写缓存
  for (const mod of MODULES) {
    const dirs = moduleReleaseDirs(mod.name)
    if (dirs.length === 0)
      throw new Error(`编译后找不到 ${mod.name} 的 build/Release 目录`)
    const source = path.join(dirs[0], mod.file)
    if (!fs.existsSync(source))
      throw new Error(`编译后缺少 ${mod.name} 产物：${source}`)
    copyToDirs(source, dirs, mod.file)
    const cached = cacheFile(mod.name, runtime, mod.file)
    fs.mkdirSync(path.dirname(cached), { recursive: true })
    copyFileAtomic(source, cached)
    console.info(`[native-abi] 已编译并缓存 ${mod.name}（${runtimeTag(runtime)}）`)
  }
}

function syncRuntime(runtime, depth = 0) {
  if (depth > 1)
    throw new Error('sync 递归超过上限，请检查 --build 是否失败')
  for (const mod of MODULES) {
    const dirs = moduleReleaseDirs(mod.name)
    if (dirs.length === 0)
      throw new Error(`找不到 ${mod.name} 的 build/Release 目录，请先 pnpm install`)
    const cached = cacheFile(mod.name, runtime, mod.file)
    if (fs.existsSync(cached)) {
      copyToDirs(cached, dirs, mod.file)
      continue
    }
    if (runtime === currentRuntime()) {
      // 缓存缺失但当前产物就是该运行时的：直接缓存（首次 install 后幂等）
      const source = path.join(dirs[0], mod.file)
      if (!fs.existsSync(source))
        throw new Error(`缺少 ${mod.name} 产物：${source}`)
      copyToDirs(source, dirs, mod.file)
      fs.mkdirSync(path.dirname(cached), { recursive: true })
      copyFileAtomic(source, cached)
      console.info(`[native-abi] 缓存 ${mod.name}（${runtimeTag(runtime)}）`)
    }
    else {
      buildRuntime(runtime)
      syncRuntime(runtime, depth + 1)
      return
    }
  }
}

function main() {
  const { build, sync } = parseArgs()
  for (const runtime of build)
    buildRuntime(runtime)
  if (sync)
    syncRuntime(sync)
  else if (build.length === 0)
    syncRuntime(currentRuntime())
}

try {
  main()
}
catch (error) {
  console.error(`[native-abi] ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
