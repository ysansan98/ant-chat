import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPathPolicy } from '../pathPolicy'

describe('classifyAccess 行为', () => {
  let workspacePath: string
  let outsidePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-pathscope-'))
    outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-outside-'))
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    fs.rmSync(outsidePath, { recursive: true, force: true })
  })

  it('工作区内相对路径 → workspace', () => {
    const policy = createPathPolicy(workspacePath)
    expect(policy.classifyAccess('.')).toBe('workspace')
    expect(policy.classifyAccess('./src')).toBe('workspace')
  })

  it('工作区内绝对路径 → workspace', () => {
    const policy = createPathPolicy(workspacePath)
    const realWorkspacePath = fs.realpathSync.native(workspacePath)
    expect(policy.classifyAccess(realWorkspacePath)).toBe('workspace')
    expect(policy.classifyAccess(path.join(realWorkspacePath, 'src'))).toBe('workspace')
  })

  it('工作区外路径 → outside', () => {
    const policy = createPathPolicy(workspacePath)
    const realOutsidePath = fs.realpathSync.native(outsidePath)
    expect(policy.classifyAccess(realOutsidePath)).toBe('outside')
    expect(policy.classifyAccess('/Users/ysansan')).toBe('outside')
  })

  it('symlink 指向工作区外 → outside', () => {
    fs.symlinkSync(outsidePath, path.join(workspacePath, 'outside-link'))
    const policy = createPathPolicy(workspacePath)
    expect(policy.classifyAccess('outside-link')).toBe('outside')
  })
})
