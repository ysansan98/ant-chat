import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { AGENT_BASH_COMMAND_BLOCKED, AGENT_POLICY_BLOCKED, WORKSPACE_INVALID_PATH } from '@ant-chat/shared'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NativeToolService } from '../native-tools/nativeToolService'
import { createPathPolicy } from '../native-tools/pathPolicy'

describe('native tool service', () => {
  let workspacePath: string
  let outsidePath: string

  beforeEach(() => {
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-workspace-'))
    outsidePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-outside-'))
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    fs.rmSync(outsidePath, { recursive: true, force: true })
  })

  it('拒绝通过 symlink 访问工作区外文件', () => {
    fs.writeFileSync(path.join(outsidePath, 'secret.txt'), 'secret')
    fs.symlinkSync(outsidePath, path.join(workspacePath, 'outside-link'))

    expect(() => createPathPolicy(workspacePath).resolveExisting('outside-link/secret.txt')).toThrow(WORKSPACE_INVALID_PATH)
  })

  it('read_file/list_dir/write_file 只在工作区内工作', async () => {
    const service = new NativeToolService(workspacePath)
    await service.writeFile({ path: 'src/a.txt', content: 'line-1\nline-2\nline-3' })

    await expect(service.readFile({ path: 'src/a.txt', offset: 2, limit: 1 })).resolves.toMatchObject({
      ok: true,
      output: '[Showing lines 2-2 of 3]\nline-2\n\n[1 more lines. Use offset=3 limit=1 to continue]',
    })
    await expect(service.listDir({ path: 'src' })).resolves.toMatchObject({
      ok: true,
      output: {
        offset: 0,
        total: 1,
        hasMore: false,
        items: [{ name: 'a.txt', type: 'file' }],
      },
    })
    await expect(service.writeFile({ path: path.join(outsidePath, 'x.txt'), content: 'x' })).rejects.toThrow(WORKSPACE_INVALID_PATH)
  })

  it('read_file 支持按行分页并返回续读提示', async () => {
    const service = new NativeToolService(workspacePath)
    await service.writeFile({ path: 'src/b.txt', content: 'a\nb\nc\nd' })

    await expect(service.readFile({ path: 'src/b.txt', offset: 2, limit: 2 })).resolves.toMatchObject({
      ok: true,
      output: '[Showing lines 2-3 of 4]\nb\nc\n\n[1 more lines. Use offset=4 limit=2 to continue]',
    })
  })

  it('read_file offset 越界时报错', async () => {
    const service = new NativeToolService(workspacePath)
    await service.writeFile({ path: 'src/c.txt', content: 'a\nb' })

    await expect(service.readFile({ path: 'src/c.txt', offset: 10, limit: 1 })).rejects.toThrow(
      'READ_FILE_OFFSET_OUT_OF_RANGE',
    )
  })

  it('apply_patch 支持多文件变更且上下文不匹配时保持原样', async () => {
    const service = new NativeToolService(workspacePath)
    fs.mkdirSync(path.join(workspacePath, 'src'))
    fs.writeFileSync(path.join(workspacePath, 'src/existing.ts'), 'export const value = 1\n')
    fs.writeFileSync(path.join(workspacePath, 'src/old.ts'), 'old\n')

    await expect(service.applyPatch({
      patch: `*** Begin Patch
*** Add File: src/new.ts
+export const next = 2
*** Update File: src/existing.ts
@@
 export const value = 1
+export const other = 2
*** Delete File: src/old.ts
*** End Patch`,
    })).resolves.toMatchObject({ ok: true })

    expect(fs.readFileSync(path.join(workspacePath, 'src/new.ts'), 'utf8')).toBe('export const next = 2\n')
    expect(fs.readFileSync(path.join(workspacePath, 'src/existing.ts'), 'utf8')).toBe('export const value = 1\nexport const other = 2\n')
    expect(fs.existsSync(path.join(workspacePath, 'src/old.ts'))).toBe(false)

    await expect(service.applyPatch({
      patch: `*** Begin Patch
*** Update File: src/existing.ts
@@
 missing context
+new line
*** Add File: src/should-not-exist.ts
+x
*** End Patch`,
    })).rejects.toThrow()

    expect(fs.existsSync(path.join(workspacePath, 'src/should-not-exist.ts'))).toBe(false)
    expect(fs.readFileSync(path.join(workspacePath, 'src/existing.ts'), 'utf8')).toBe('export const value = 1\nexport const other = 2\n')
  })

  it('apply_patch 整体拒绝越界路径', async () => {
    const service = new NativeToolService(workspacePath)
    await expect(service.applyPatch({
      patch: `*** Begin Patch
*** Add File: ok.ts
+ok
*** Add File: ../bad.ts
+bad
*** End Patch`,
    })).rejects.toThrow(WORKSPACE_INVALID_PATH)

    expect(fs.existsSync(path.join(workspacePath, 'ok.ts'))).toBe(false)
  })

  it('bash 阻断危险命令并允许低风险 mkdir', async () => {
    const service = new NativeToolService(workspacePath)
    const bash = service.getTools().find(tool => tool.name === 'bash')!

    await expect(bash.execute({ command: 'rm -rf src' })).resolves.toMatchObject({
      ok: false,
      error: AGENT_BASH_COMMAND_BLOCKED,
    })

    await expect(bash.execute({ command: 'mkdir -p src/nested' })).resolves.toMatchObject({ ok: true })
    expect(fs.statSync(path.join(workspacePath, 'src/nested')).isDirectory()).toBe(true)
    await expect(bash.execute({ command: 'pwd && ls -la' })).resolves.toMatchObject({ ok: true })
  })

  it('tool execute 遇到越界路径返回 AGENT_POLICY_BLOCKED', async () => {
    const service = new NativeToolService(workspacePath)
    const readFile = service.getTools().find(tool => tool.name === 'read_file')!
    const result = await readFile.execute({ path: path.join(outsidePath, 'secret.txt') })
    expect(result.ok).toBe(false)
    expect(result.error).toContain(AGENT_POLICY_BLOCKED)
  })

  describe('inferScope', () => {
    it('read_file 工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'read_file')!
      expect(tool.inferScope({ path: 'src/a.txt' })).toBe('workspace')
    })

    it('read_file 工作区外 → outside', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'read_file')!
      expect(tool.inferScope({ path: outsidePath })).toBe('outside')
    })

    it('glob_files 工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'glob_files')!
      expect(tool.inferScope({ pattern: '*.ts' })).toBe('workspace')
    })

    it('glob_files 工作区外路径 → outside', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'glob_files')!
      expect(tool.inferScope({ pattern: '*.ts', path: outsidePath })).toBe('outside')
    })

    it('write_file 工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'write_file')!
      expect(tool.inferScope({ path: 'src/new.txt', content: 'x' })).toBe('workspace')
    })

    it('write_file 工作区外 → outside', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'write_file')!
      expect(tool.inferScope({ path: path.join(outsidePath, 'x.txt'), content: 'x' })).toBe('outside')
    })

    it('bash find /Users → outside（路径逃逸，可审批）', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'find /Users/ysansan -name "*.pdf"' })).toBe('outside')
      expect(tool.inferScope({ command: 'find ~/Documents -name "*.pdf"' })).toBe('outside')
    })

    it('bash 安全命令工作区内 → workspace', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'ls' })).toBe('workspace')
      expect(tool.inferScope({ command: 'find . -name "*.ts"' })).toBe('workspace')
    })

    it('bash rm/sudo/curl → outside（需审批）', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'rm -rf src' })).toBe('outside')
      expect(tool.inferScope({ command: 'sudo ls' })).toBe('outside')
      expect(tool.inferScope({ command: 'curl http://example.com' })).toBe('outside')
    })

    it('bash 管道重定向 → outside（需审批）', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'ls | grep foo' })).toBe('outside')
      expect(tool.inferScope({ command: 'find . > /tmp/out' })).toBe('outside')
    })

    it('bash 非只读命令 → outside（需审批）', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: 'git status' })).toBe('outside')
    })

    it('bash 空命令 → blocked', () => {
      const service = new NativeToolService(workspacePath)
      const tool = service.getTools().find(t => t.name === 'bash')!
      expect(tool.inferScope({ command: '' })).toBe('blocked')
    })
  })
})
