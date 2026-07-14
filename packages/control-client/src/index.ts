#!/usr/bin/env node

import process from 'node:process'
import { resolveAppDataRoot } from '@ant-chat/shared'
import { executeCommand } from './commands'
import { SocketClient } from './socket-client'

export interface RunControlCliOptions {
  appDataRoot?: string
}

export interface ControlCliResult {
  exitCode: number
  output?: string
  error?: string
}

/**
 * 执行控制面 CLI。产品包和 Desktop launcher 共用这条路径，避免复制命令解析和输出逻辑。
 */
export async function runControlCli(argv: string[], options: RunControlCliOptions = {}): Promise<ControlCliResult> {
  const parsed = extractDataDir(argv)

  // --json 标志
  const jsonIndex = argv.indexOf('--json')
  const json = jsonIndex !== -1
  if (jsonIndex !== -1) {
    argv.splice(jsonIndex, 1)
  }

  const client = new SocketClient(options.appDataRoot ?? parsed.dataDir ?? process.env.ANT_CHAT_DATA_ROOT ?? resolveAppDataRoot())
  return executeCommand(client, parsed.argv, { json })
}

function extractDataDir(argv: string[]): { argv: string[], dataDir?: string } {
  const remaining: string[] = []
  let dataDir: string | undefined
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--data-dir') {
      const value = argv[++index]
      if (!value || value.startsWith('--'))
        throw new Error('--data-dir 需要一个值')
      dataDir = value
      continue
    }
    if (arg.startsWith('--data-dir=')) {
      dataDir = arg.slice('--data-dir='.length)
      if (!dataDir)
        throw new Error('--data-dir 需要一个值')
      continue
    }
    remaining.push(arg)
  }
  return { argv: remaining, dataDir }
}
