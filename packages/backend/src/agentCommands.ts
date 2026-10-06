import type { AgentCommandStoragePaths } from '@ant-chat/shared'
import os from 'node:os'
import path from 'node:path'

/** 后台命令的产物路径：日志文件与孤儿兜底状态文件。 */
export type AgentCommandPaths = AgentCommandStoragePaths

export function createAgentCommandPaths(appDataRoot: string = path.join(os.homedir(), '.ant-chat')): AgentCommandPaths {
  const root = path.join(appDataRoot, 'commands')
  return {
    root,
    logsPath: path.join(root, 'logs'),
    statePath: path.join(root, 'state'),
  }
}
