#!/usr/bin/env node

import process from 'node:process'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { executeCommand } from './commands'
import { SocketClient } from './socket-client'

// 默认 appDataRoot，与桌面端和 local-server 共享路径（~/.ant-chat）
const APP_DATA_ROOT = process.env.ANT_CHAT_DATA_ROOT ?? resolveAppDataRoot()

async function main() {
  const argv = process.argv.slice(2)

  // --json 标志
  const jsonIndex = argv.indexOf('--json')
  const json = jsonIndex !== -1
  if (jsonIndex !== -1) {
    argv.splice(jsonIndex, 1)
  }

  const client = new SocketClient(APP_DATA_ROOT)
  const result = await executeCommand(client, argv, { json })

  if (result.output) {
    process.stdout.write(`${result.output}\n`)
  }
  if (result.error) {
    process.stderr.write(`${result.error}\n`)
  }
  process.exit(result.exitCode)
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
