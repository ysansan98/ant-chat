import type { ToolApprovalWhitelistEntry, ToolScope } from '@ant-chat/shared'
import path from 'node:path'

const FILE_TOOLS = new Set([
  'read_file',
  'write_file',
  'edit_file',
  'list_dir',
  'glob_files',
  'grep_files',
])

export function extractInputKey(toolName: string, input: Record<string, unknown>): string {
  if (toolName === 'bash') {
    return String(input.command ?? '')
  }
  if (FILE_TOOLS.has(toolName)) {
    return String(input.path ?? '')
  }
  if (toolName === 'use_skill' || toolName === 'install_skill_from_github') {
    return String(input.name ?? '')
  }
  return ''
}

export function generatePattern(
  toolName: string,
  input: Record<string, unknown>,
  toolScope: ToolScope,
  workspacePath?: string,
): string {
  if (toolName === 'bash') {
    const cmd = String(input.command ?? '')
    const firstWord = cmd.split(/\s+/)[0] ?? ''
    return firstWord ? `${firstWord} **` : cmd
  }

  if (FILE_TOOLS.has(toolName)) {
    const filePath = String(input.path ?? '')
    if (!filePath) {
      return '*'
    }

    if (toolScope === 'workspace' && workspacePath) {
      try {
        const relative = path.relative(workspacePath, filePath)
        if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
          const dir = path.dirname(relative)
          return dir === '.' ? './**' : `.${path.sep}${dir}${path.sep}**`
        }
      }
      catch {
        // fall through to absolute path
      }
    }

    // outside workspace or no workspacePath: use absolute path directory
    const dir = path.dirname(filePath)
    return `${dir}${path.sep}**`
  }

  // skills and other tools: exact match
  return extractInputKey(toolName, input)
}

function normalizeInputKey(
  toolName: string,
  inputKey: string,
  workspacePath?: string,
): string {
  if (!workspacePath)
    return inputKey
  if (!FILE_TOOLS.has(toolName))
    return inputKey

  try {
    const relative = path.relative(workspacePath, inputKey)
    if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
      return relative === '.' ? '.' : `.${path.sep}${relative}`
    }
  }
  catch {
    // path.relative may throw on different drives (Windows)
  }

  return inputKey
}

function globToRegex(pattern: string): RegExp {
  let regexStr = ''
  let i = 0
  while (i < pattern.length) {
    if (pattern[i] === '*' && pattern[i + 1] === '*') {
      regexStr += '.*'
      i += 2
    }
    else if (pattern[i] === '*') {
      regexStr += '[^/]*'
      i += 1
    }
    else {
      regexStr += escapeRegex(pattern[i]!)
      i += 1
    }
  }
  return new RegExp(`^${regexStr}$`, 's')
}

function escapeRegex(char: string): string {
  const specials = '.+?^${}()|[]\\'
  return specials.includes(char) ? `\\${char}` : char
}

export function matchPattern(pattern: string, inputKey: string): boolean {
  return globToRegex(pattern).test(inputKey)
}

export function isWhitelisted(
  entries: ToolApprovalWhitelistEntry[],
  toolName: string,
  toolScope: ToolScope,
  inputKey: string,
  currentWorkspace?: string,
): ToolApprovalWhitelistEntry | undefined {
  const normalizedKey = normalizeInputKey(toolName, inputKey, currentWorkspace)

  return entries.find((entry) => {
    if (entry.toolName !== toolName || entry.toolScope !== toolScope)
      return false

    if (entry.workspacePath !== undefined) {
      if (entry.workspacePath !== currentWorkspace)
        return false
    }

    return matchPattern(entry.pattern, normalizedKey)
  })
}
