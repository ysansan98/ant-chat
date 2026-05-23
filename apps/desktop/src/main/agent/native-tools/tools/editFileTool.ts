import type { AgentToolResult, EditFileToolInput } from '@ant-chat/shared'
import type { PathPolicy } from '../pathPolicy'
import fs from 'node:fs'
import path from 'node:path'
import { createNativeTool } from './toolFactory'

interface Edit {
  oldText: string
  newText: string
}

interface MatchedEdit {
  editIndex: number
  matchIndex: number
  matchLength: number
  newText: string
}

export async function editFile(input: EditFileToolInput, pathPolicy: PathPolicy, workspacePath: string): Promise<AgentToolResult> {
  const { path: inputPath, edits } = validateEditInput(input)
  const filePath = pathPolicy.resolveExisting(inputPath)
  await fs.promises.access(filePath, fs.constants.R_OK | fs.constants.W_OK)

  const rawContent = await fs.promises.readFile(filePath, 'utf8')
  const { bom, text: content } = stripBom(rawContent)
  const originalLineEnding = detectLineEnding(content)
  const normalizedContent = normalizeToLF(content)
  const newContent = applyEditsToNormalizedContent(normalizedContent, edits, inputPath)
  const finalContent = bom + restoreLineEndings(newContent, originalLineEnding)

  await fs.promises.writeFile(filePath, finalContent, 'utf8')
  return {
    ok: true,
    output: {
      path: path.relative(fs.realpathSync.native(workspacePath), filePath),
      replacements: edits.length,
    },
  }
}

export function createEditFileTool(pathPolicy: PathPolicy, workspacePath: string, unrestricted: boolean) {
  return createNativeTool({
    name: 'edit_file',
    description: '对单个文件做精确文本替换。每个 edits[].oldText 必须唯一匹配且不能和其他替换重叠；修改同一邻近代码块时应合并为一个替换项',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        edits: { type: 'array', items: { type: 'object', properties: { oldText: { type: 'string' }, newText: { type: 'string' } }, required: ['oldText', 'newText'] } },
      },
      required: ['path', 'edits'],
    },
    unrestricted,
    inferScope: input => pathPolicy.classifyAccess((input as unknown as EditFileToolInput).path),
    execute: input => editFile(input as unknown as EditFileToolInput, pathPolicy, workspacePath),
  })
}

function validateEditInput(input: EditFileToolInput): { path: string, edits: Edit[] } {
  if (!input.path || typeof input.path !== 'string') {
    throw new Error('edit_file 参数错误：path 不能为空')
  }
  if (!Array.isArray(input.edits) || input.edits.length === 0) {
    throw new Error('edit_file 参数错误：edits 必须包含至少一个替换项')
  }

  const edits = input.edits.map((edit, index) => {
    if (!edit || typeof edit.oldText !== 'string' || typeof edit.newText !== 'string') {
      throw new Error(`edit_file 参数错误：edits[${index}] 必须包含字符串 oldText 和 newText`)
    }
    if (edit.oldText.length === 0) {
      throw new Error(`edit_file 参数错误：edits[${index}].oldText 不能为空`)
    }
    return edit
  })

  return { path: input.path, edits }
}

function applyEditsToNormalizedContent(normalizedContent: string, edits: Edit[], inputPath: string): string {
  const normalizedEdits = edits.map(edit => ({
    oldText: normalizeToLF(edit.oldText),
    newText: normalizeToLF(edit.newText),
  }))

  const matchedEdits: MatchedEdit[] = []
  for (let index = 0; index < normalizedEdits.length; index++) {
    const edit = normalizedEdits[index]
    const occurrences = countOccurrences(normalizedContent, edit.oldText)
    if (occurrences === 0) {
      throw new Error(getNotFoundMessage(inputPath, index, normalizedEdits.length))
    }
    if (occurrences > 1) {
      throw new Error(getDuplicateMessage(inputPath, index, normalizedEdits.length, occurrences))
    }

    matchedEdits.push({
      editIndex: index,
      matchIndex: normalizedContent.indexOf(edit.oldText),
      matchLength: edit.oldText.length,
      newText: edit.newText,
    })
  }

  matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex)
  for (let index = 1; index < matchedEdits.length; index++) {
    const previous = matchedEdits[index - 1]
    const current = matchedEdits[index]
    if (previous.matchIndex + previous.matchLength > current.matchIndex) {
      throw new Error(`edit_file 失败：edits[${previous.editIndex}] 和 edits[${current.editIndex}] 在 ${inputPath} 中重叠，请合并为一个替换项`)
    }
  }

  let newContent = normalizedContent
  for (let index = matchedEdits.length - 1; index >= 0; index--) {
    const edit = matchedEdits[index]
    newContent = `${newContent.slice(0, edit.matchIndex)}${edit.newText}${newContent.slice(edit.matchIndex + edit.matchLength)}`
  }

  if (newContent === normalizedContent) {
    throw new Error(`edit_file 失败：${inputPath} 替换后内容没有变化`)
  }

  return newContent
}

function countOccurrences(content: string, oldText: string): number {
  let count = 0
  let startIndex = 0
  while (true) {
    const index = content.indexOf(oldText, startIndex)
    if (index === -1) {
      return count
    }
    count += 1
    startIndex = index + oldText.length
  }
}

function detectLineEnding(content: string): '\r\n' | '\n' {
  const crlfIndex = content.indexOf('\r\n')
  const lfIndex = content.indexOf('\n')
  if (lfIndex === -1 || crlfIndex === -1) {
    return '\n'
  }
  return crlfIndex < lfIndex ? '\r\n' : '\n'
}

function normalizeToLF(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

function restoreLineEndings(text: string, ending: '\r\n' | '\n'): string {
  return ending === '\r\n' ? text.replace(/\n/g, '\r\n') : text
}

function stripBom(content: string): { bom: string, text: string } {
  return content.startsWith('\uFEFF') ? { bom: '\uFEFF', text: content.slice(1) } : { bom: '', text: content }
}

function getNotFoundMessage(inputPath: string, editIndex: number, totalEdits: number): string {
  return totalEdits === 1
    ? `edit_file 失败：在 ${inputPath} 中找不到 oldText，文本必须完全匹配空白和换行`
    : `edit_file 失败：在 ${inputPath} 中找不到 edits[${editIndex}].oldText，文本必须完全匹配空白和换行`
}

function getDuplicateMessage(inputPath: string, editIndex: number, totalEdits: number, occurrences: number): string {
  return totalEdits === 1
    ? `edit_file 失败：在 ${inputPath} 中找到 ${occurrences} 处 oldText，oldText 必须唯一，请提供更多上下文`
    : `edit_file 失败：在 ${inputPath} 中找到 ${occurrences} 处 edits[${editIndex}].oldText，每个 oldText 必须唯一`
}
