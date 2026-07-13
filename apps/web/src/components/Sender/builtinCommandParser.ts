import type { ParsedCommand } from './inputReferences'
import { BUILTIN_COMMANDS } from '@ant-chat/shared'

const EMPTY_SKILL_NAMES: ReadonlySet<string> = new Set()

/**
 * 从草稿文本识别内置指令。
 *
 * `/compact` 允许多行参数；`/new`、`/fork` 不允许参数。内置指令不能与
 * `@workspace/path` 或另一个 Skill token 混用。
 */
export function hasWorkspacePathReference(text: string): boolean {
  return /(?:^|\s)@\S+/u.test(text)
}

function findLeadingSkillReference(text: string): string | undefined {
  return /^\/([\w.-]+)(?=\s|$)/u.exec(text.trim())?.[1]
}

export function hasSkillReference(text: string, knownSkillNames: ReadonlySet<string> = EMPTY_SKILL_NAMES): boolean {
  const skillReference = findLeadingSkillReference(text)
  return Boolean(skillReference && knownSkillNames.has(skillReference))
}

export function parseBuiltinCommand(text: string, knownSkillNames: ReadonlySet<string> = EMPTY_SKILL_NAMES): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) {
    return null
  }

  const commandMatch = /^\/(\w+)(?:\s|$)/.exec(trimmed)
  if (!commandMatch) {
    return null
  }

  const commandName = commandMatch[1]
  const command = BUILTIN_COMMANDS.find(c => c.id === commandName)
  if (!command) {
    return null
  }

  if (hasWorkspacePathReference(trimmed)) {
    throw new Error(`/${command.id} cannot be combined with @file references`)
  }

  const remainder = trimmed.slice(commandMatch[0].length).trim()
  const skillReference = findLeadingSkillReference(remainder)
  if (skillReference && knownSkillNames.has(skillReference)) {
    throw new Error(`/${command.id} cannot be combined with skill /${skillReference}`)
  }

  if (command.allowArgument) {
    // 保留指令之后的完整多行参数。
    return { id: command.id, argument: remainder || undefined }
  }

  if (remainder.length > 0) {
    throw new Error(`/${command.id} does not accept arguments`)
  }

  return { id: command.id }
}

/** 返回用于筛选内置指令建议的 query；未触发时返回 null。 */
export function getCommandTriggerQuery(text: string, cursor: number): string | null {
  const beforeCursor = text.slice(0, cursor)
  const match = /(?:^|\s)\/(\S*)$/.exec(beforeCursor)
  if (!match || match.index === undefined) {
    return null
  }
  return match[1].toLowerCase()
}
