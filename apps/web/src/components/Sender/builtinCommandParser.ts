import type { ParsedCommand } from './inputReferences'
import { BUILTIN_COMMANDS } from '@ant-chat/shared'

/**
 * Parse draft text to detect a built-in command.
 * Returns the command and its argument if the draft is a valid command invocation,
 * or null if the draft is a regular message or an invalid command mix.
 *
 * Rules:
 * - `/compact [instruction]` — multi-line argument allowed
 * - `/new` — no argument, no attachments, no other text
 * - `/fork` — no argument, no attachments, no other text
 * - Rejects if the command is mixed with @file references, other skill refs, or attachments
 */
export function parseBuiltinCommand(
  text: string,
  referencedFiles: string[],
  selectedSkill?: string,
): ParsedCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) {
    return null
  }

  // Check for mixed references: reject if there are @file refs or a selected skill
  // alongside what looks like a built-in command
  const commandMatch = /^\/(\w+)(?:\s|$)/.exec(trimmed)
  if (!commandMatch) {
    return null
  }

  const commandName = commandMatch[1]
  const command = BUILTIN_COMMANDS.find(c => c.id === commandName)
  if (!command) {
    return null
  }

  // Reject if mixed with attachments or file references
  if (referencedFiles.length > 0) {
    throw new Error(`/${command.id} cannot be combined with @file references`)
  }

  // Reject if a different skill is selected
  if (selectedSkill && selectedSkill !== command.id) {
    throw new Error(`/${command.id} cannot be combined with skill /${selectedSkill}`)
  }

  if (command.allowArgument) {
    // /compact: everything after "/compact " is the argument (multi-line allowed)
    const afterCommand = trimmed.slice(commandMatch[0].length).trim()
    return { id: command.id, argument: afterCommand || undefined }
  }

  // /new, /fork: no argument allowed beyond the command itself
  const remainder = trimmed.slice(commandMatch[0].length).trim()
  if (remainder.length > 0) {
    throw new Error(`/${command.id} does not accept arguments`)
  }

  return { id: command.id }
}

/**
 * Check if a draft text triggers built-in command suggestions.
 * Returns the query string for filtering commands, or null.
 */
export function getCommandTriggerQuery(text: string, cursor: number): string | null {
  const beforeCursor = text.slice(0, cursor)
  const match = /(?:^|\s)\/(\S*)$/.exec(beforeCursor)
  if (!match || match.index === undefined) {
    return null
  }
  return match[1].toLowerCase()
}
