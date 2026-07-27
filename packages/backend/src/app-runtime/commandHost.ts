import type { CommandInterpreter } from '@ant-chat/shared'
import type { CommandHost } from '../agent-core/native-tools/command/types'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

export interface CommandHostFileSystem {
  isExecutable: (filePath: string) => boolean
  realpath: (filePath: string) => string
}

export interface DetectCommandHostOptions {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  fileSystem?: CommandHostFileSystem
}

const defaultFileSystem: CommandHostFileSystem = {
  isExecutable(filePath) {
    try {
      fs.accessSync(filePath, fs.constants.X_OK)
      return fs.statSync(filePath).isFile()
    }
    catch {
      return false
    }
  },
  realpath(filePath) {
    return fs.realpathSync(filePath)
  },
}

/**
 * 启动期探测一次命令解释器。返回值固定授权和执行共同使用的解释器身份，
 * 避免运行中 PATH 或宿主默认 shell 变化导致执行对象漂移。
 */
export function detectCommandHost(options: DetectCommandHostOptions = {}): CommandHost {
  const platform = options.platform ?? process.platform
  const environment = options.environment ?? process.env
  const fileSystem = options.fileSystem ?? defaultFileSystem
  return platform === 'win32'
    ? detectWindowsCommandHost(environment, fileSystem)
    : detectPosixCommandHost(environment, fileSystem)
}

function detectPosixCommandHost(
  environment: NodeJS.ProcessEnv,
  fileSystem: CommandHostFileSystem,
): CommandHost {
  const candidates = uniquePaths([
    ...splitPath(environment.PATH, ':').map(directory => path.posix.join(directory, 'bash')),
    '/bin/bash',
    '/usr/bin/bash',
  ], false)
  const executablePath = findExecutable(candidates, fileSystem)
  if (!executablePath) {
    return {
      status: 'unavailable',
      platform: 'posix',
      candidates,
      reason: '未找到可执行的 Bash，请安装 Bash 或检查 PATH。',
    }
  }

  return {
    status: 'available',
    platform: 'posix',
    adapter: 'bash',
    interpreter: 'bash',
    executablePath,
    environment: definedEnvironment(environment, ['PATH', 'HOME', 'USER', 'TMPDIR']),
  }
}

function detectWindowsCommandHost(
  environment: NodeJS.ProcessEnv,
  fileSystem: CommandHostFileSystem,
): CommandHost {
  const commandEnvironment = definedWindowsEnvironment(environment)
  const systemRoot = commandEnvironment.SystemRoot
  const programFiles = commandEnvironment.ProgramFiles
  const pathDirectories = splitPath(commandEnvironment.PATH, ';')
  const candidatesByInterpreter: Array<{
    interpreter: Exclude<CommandInterpreter, 'bash'>
    paths: string[]
  }> = [
    {
      interpreter: 'powershell7',
      paths: uniquePaths([
        ...pathDirectories.map(directory => path.win32.join(directory, 'pwsh.exe')),
        programFiles ? path.win32.join(programFiles, 'PowerShell', '7', 'pwsh.exe') : '',
      ], true),
    },
    {
      interpreter: 'windows-powershell',
      paths: uniquePaths([
        ...pathDirectories.map(directory => path.win32.join(directory, 'powershell.exe')),
        systemRoot ? path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe') : '',
      ], true),
    },
    {
      interpreter: 'cmd',
      paths: uniquePaths([
        commandEnvironment.ComSpec || '',
        ...pathDirectories.map(directory => path.win32.join(directory, 'cmd.exe')),
        systemRoot ? path.win32.join(systemRoot, 'System32', 'cmd.exe') : '',
      ], true),
    },
  ]

  for (const candidate of candidatesByInterpreter) {
    const executablePath = findExecutable(candidate.paths, fileSystem)
    if (executablePath) {
      return {
        status: 'available',
        platform: 'windows',
        adapter: 'windows',
        interpreter: candidate.interpreter,
        executablePath,
        environment: commandEnvironment,
      }
    }
  }

  return {
    status: 'unavailable',
    platform: 'windows',
    candidates: candidatesByInterpreter.flatMap(candidate => candidate.paths),
    reason: '未找到可用的 PowerShell 或 CMD。请安装 PowerShell 7，或检查 powershell.exe、cmd.exe 和 PATH。',
  }
}

function findExecutable(
  candidates: string[],
  fileSystem: CommandHostFileSystem,
): string | undefined {
  for (const candidate of candidates) {
    try {
      if (fileSystem.isExecutable(candidate)) {
        return fileSystem.realpath(candidate)
      }
    }
    catch {
      // 单个候选损坏不应让命令宿主探测阻止应用启动。
    }
  }
  return undefined
}

function splitPath(value: string | undefined, delimiter: string): string[] {
  return (value || '')
    .split(delimiter)
    .map(item => item.trim())
    .filter(Boolean)
}

function uniquePaths(paths: string[], caseInsensitive: boolean): string[] {
  const seen = new Set<string>()
  return paths.filter((candidate) => {
    if (!candidate)
      return false
    const identity = caseInsensitive ? candidate.toLowerCase() : candidate
    if (seen.has(identity))
      return false
    seen.add(identity)
    return true
  })
}

function definedEnvironment(
  environment: NodeJS.ProcessEnv,
  keys: string[],
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of keys) {
    const value = environment[key]
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}

function definedWindowsEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return definedEnvironmentCaseInsensitive(environment, [
    'PATH',
    'PATHEXT',
    'SystemRoot',
    'ComSpec',
    'USERPROFILE',
    'TEMP',
    'TMP',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramData',
  ])
}

function definedEnvironmentCaseInsensitive(
  environment: NodeJS.ProcessEnv,
  keys: string[],
): Record<string, string> {
  const valuesByKey = new Map(
    Object.entries(environment).map(([key, value]) => [key.toLowerCase(), value]),
  )
  const result: Record<string, string> = {}
  for (const key of keys) {
    const value = environment[key] ?? valuesByKey.get(key.toLowerCase())
    if (value !== undefined) {
      result[key] = value
    }
  }
  return result
}
