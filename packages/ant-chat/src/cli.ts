#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { runControlCli } from '@ant-chat/control-client'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { CLI_HELP, parseCliArgs } from './cliOptions'
import { startLocalServer } from './server'

async function main(): Promise<void> {
  const action = parseCliArgs(process.argv.slice(2))

  if (action.type === 'help') {
    process.stdout.write(CLI_HELP)
    return
  }

  if (action.type === 'version') {
    process.stdout.write(`${readPackageVersion()}\n`)
    return
  }

  const appDataRoot = path.resolve(action.options.dataDir ?? process.env.ANT_CHAT_DATA_ROOT ?? resolveAppDataRoot())

  if (action.type === 'control') {
    const result = await runControlCli(action.argv, { appDataRoot })
    if (result.output)
      process.stdout.write(`${result.output}\n`)
    if (result.error)
      process.stderr.write(`${result.error}\n`)
    process.exitCode = result.exitCode
    return
  }

  const server = await startLocalServer({
    appDataRoot,
    ...action.options,
  })
  const displayHost = server.host === '0.0.0.0' ? '127.0.0.1' : server.host
  console.info(`Ant Chat 已启动：http://${displayHost}:${server.port}`)
  console.info(`数据目录：${appDataRoot}`)
  if (server.host === '0.0.0.0') {
    console.info(`局域网访问：http://<本机 IP>:${server.port}`)
    console.warn('警告：当前 HTTP Web UI、RPC 和 SSE 没有鉴权，禁止直接暴露到公网。')
  }

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown)
      return
    shuttingDown = true
    console.info('正在关闭 Ant Chat')
    await server.close()
  }

  process.on('SIGINT', () => void shutdown())
  process.on('SIGTERM', () => void shutdown())
}

function readPackageVersion(): string {
  const packageJsonPath = new URL('../package.json', import.meta.url)
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string }
  return packageJson.version
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  if ((error as NodeJS.ErrnoException)?.code === 'EADDRINUSE') {
    console.error(`${message}；端口已被占用，请使用 --port 指定其他端口。`)
  }
  else {
    console.error(message)
  }
  process.exitCode = 1
})
