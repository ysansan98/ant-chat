#!/usr/bin/env node

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
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

  const server = await startLocalServer({
    appDataRoot: path.join(os.homedir(), '.ant-chat'),
    ...action.options,
  })
  const displayHost = server.host === '0.0.0.0' ? '127.0.0.1' : server.host
  console.info(`Ant Chat 已启动：http://${displayHost}:${server.port}`)
  if (server.host === '0.0.0.0')
    console.info(`局域网访问：http://<本机 IP>:${server.port}`)

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
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
