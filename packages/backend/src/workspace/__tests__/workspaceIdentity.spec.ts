import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { canonicalizeWorkspacePath } from '../workspaceIdentity'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true })
})

describe('工作区身份规范化', () => {
  it('将工作区路径规范化为真实目录身份', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-workspace-'))
    temporaryDirectories.push(root)
    const target = path.join(root, 'target')
    const link = path.join(root, 'link')
    fs.mkdirSync(target)
    fs.symlinkSync(target, link, 'dir')

    expect(canonicalizeWorkspacePath(link)).toBe(fs.realpathSync.native(target))
  })

  it('拒绝相对路径和文件路径', () => {
    expect(() => canonicalizeWorkspacePath('relative/path')).toThrow('工作区路径必须是绝对路径')

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-workspace-'))
    temporaryDirectories.push(root)
    const file = path.join(root, 'file.txt')
    fs.writeFileSync(file, 'content')

    expect(() => canonicalizeWorkspacePath(file)).toThrow('工作区路径必须指向目录')
  })
})
