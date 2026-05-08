import type { AgentToolResult, ApplyPatchToolInput, ToolScope } from '@ant-chat/shared'
import type { PathPolicy } from '../pathPolicy'
import fs from 'node:fs'
import path from 'node:path'
import { createNativeTool } from './toolFactory'

type PatchOperation
  = | { type: 'add', filePath: string, content: string }
    | { type: 'delete', filePath: string }
    | { type: 'update', filePath: string, hunks: Array<{ oldText: string, newText: string, hasContext: boolean }> }

type PatchHunk = Extract<PatchOperation, { type: 'update' }>['hunks'][number]

export async function applyPatch(input: ApplyPatchToolInput, pathPolicy: PathPolicy): Promise<AgentToolResult> {
  const operations = parsePatch(input.patch)
  const writes = new Map<string, string | null>()

  for (const operation of operations) {
    if (operation.type === 'add') {
      const filePath = pathPolicy.resolvePatchPath(operation.filePath, 'write')
      if (fs.existsSync(filePath)) {
        throw new Error(`apply_patch 失败：Add File 操作的目标文件已存在 "${operation.filePath}"`)
      }
      writes.set(filePath, operation.content)
    }

    if (operation.type === 'delete') {
      const filePath = pathPolicy.resolvePatchPath(operation.filePath, 'existing')
      writes.set(filePath, null)
    }

    if (operation.type === 'update') {
      const filePath = pathPolicy.resolvePatchPath(operation.filePath, 'existing')
      let content = fs.readFileSync(filePath, 'utf8')

      for (const hunk of operation.hunks) {
        if (!hunk.hasContext || !content.includes(hunk.oldText)) {
          throw new Error(`apply_patch 失败：Update File "${operation.filePath}" 中的 hunk 匹配失败，oldText 在当前文件内容中未找到`)
        }
        content = content.replace(hunk.oldText, hunk.newText)
      }

      writes.set(filePath, content)
    }
  }

  const backups = new Map<string, string | null>()
  try {
    for (const [filePath] of writes.entries()) {
      backups.set(filePath, fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null)
    }

    for (const [filePath, content] of writes.entries()) {
      if (content === null) {
        await fs.promises.unlink(filePath)
      }
      else {
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
        await fs.promises.writeFile(filePath, content, 'utf8')
      }
    }
  }
  catch (err) {
    for (const [filePath, backup] of backups.entries()) {
      if (backup === null) {
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath)
        }
        continue
      }
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
      await fs.promises.writeFile(filePath, backup, 'utf8')
    }
    throw new Error(`apply_patch 失败：文件写入异常，已回滚所有更改。原因: ${err instanceof Error ? err.message : '未知错误'}`)
  }

  return { ok: true, output: { changedFiles: writes.size } }
}

export function createApplyPatchTool(pathPolicy: PathPolicy, unrestricted: boolean) {
  return createNativeTool({
    name: 'apply_patch',
    unrestricted,
    inferScope: input => inferPatchScope(input as unknown as ApplyPatchToolInput, pathPolicy),
    execute: input => applyPatch(input as unknown as ApplyPatchToolInput, pathPolicy),
  })
}

function inferPatchScope(input: ApplyPatchToolInput, pathPolicy: PathPolicy): ToolScope {
  try {
    const operations = parsePatch(input.patch)
    for (const op of operations) {
      if (pathPolicy.classifyAccess(op.filePath) === 'outside') {
        return 'outside'
      }
    }
    return 'workspace'
  }
  catch {
    return 'blocked'
  }
}

function parsePatch(patch: string): PatchOperation[] {
  const lines = patch.replace(/\r\n/g, '\n').split('\n')
  if (lines.at(-1) === '') {
    lines.pop()
  }
  if (lines[0] !== '*** Begin Patch' || lines.at(-1) !== '*** End Patch') {
    throw new Error('apply_patch 参数错误：patch 必须以 "*** Begin Patch" 开头且以 "*** End Patch" 结尾')
  }

  const operations: PatchOperation[] = []
  let index = 1
  while (index < lines.length - 1) {
    const line = lines[index]
    if (line.startsWith('*** Add File: ')) {
      const filePath = line.slice('*** Add File: '.length)
      index += 1
      const contentLines: string[] = []
      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (!lines[index].startsWith('+')) {
          throw new Error('apply_patch 格式错误：Add File 内容行必须以 \'+\' 开头')
        }
        contentLines.push(lines[index].slice(1))
        index += 1
      }
      operations.push({ type: 'add', filePath, content: `${contentLines.join('\n')}\n` })
      continue
    }

    if (line.startsWith('*** Delete File: ')) {
      operations.push({ type: 'delete', filePath: line.slice('*** Delete File: '.length) })
      index += 1
      continue
    }

    if (line.startsWith('*** Update File: ')) {
      const filePath = line.slice('*** Update File: '.length)
      index += 1
      const hunks: PatchHunk[] = []

      while (index < lines.length - 1 && !lines[index].startsWith('*** ')) {
        if (lines[index] !== '@@') {
          throw new Error('apply_patch 格式错误：Update File 的 hunk 必须以 \'@@\' 标记开始')
        }
        index += 1

        const oldLines: string[] = []
        const newLines: string[] = []
        let hasContext = false
        while (index < lines.length - 1 && lines[index] !== '@@' && !lines[index].startsWith('*** ')) {
          const patchLine = lines[index]
          if (patchLine.startsWith(' ')) {
            const value = patchLine.slice(1)
            oldLines.push(value)
            newLines.push(value)
            hasContext = true
          }
          else if (patchLine.startsWith('-')) {
            oldLines.push(patchLine.slice(1))
          }
          else if (patchLine.startsWith('+')) {
            newLines.push(patchLine.slice(1))
          }
          else {
            throw new Error('apply_patch 格式错误：hunk 内每行必须以 \' \'、\'-\' 或 \'+\' 开头')
          }
          index += 1
        }

        hunks.push({
          oldText: `${oldLines.join('\n')}\n`,
          newText: `${newLines.join('\n')}\n`,
          hasContext,
        })
      }

      operations.push({ type: 'update', filePath, hunks })
      continue
    }

    throw new Error('apply_patch 格式错误：未知的 patch 操作类型，期望 \'*** Add File:\' / \'*** Delete File:\' / \'*** Update File:\'')
  }

  if (operations.length === 0) {
    throw new Error('apply_patch 格式错误：patch 未包含任何有效操作')
  }

  return operations
}
