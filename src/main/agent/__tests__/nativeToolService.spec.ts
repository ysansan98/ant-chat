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
    await service.writeFile({ path: 'src/a.txt', content: 'hello world' })

    await expect(service.readFile({ path: 'src/a.txt', offset: 6, limit: 5 })).resolves.toMatchObject({
      ok: true,
      output: 'world',
    })
    await expect(service.listDir({ path: 'src' })).resolves.toMatchObject({
      ok: true,
      output: [{ name: 'a.txt', type: 'file' }],
    })
    await expect(service.writeFile({ path: path.join(outsidePath, 'x.txt'), content: 'x' })).rejects.toThrow(WORKSPACE_INVALID_PATH)
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
  })

  it('tool execute 遇到越界路径返回 AGENT_POLICY_BLOCKED', async () => {
    const service = new NativeToolService(workspacePath)
    const readFile = service.getTools().find(tool => tool.name === 'read_file')!
    const result = await readFile.execute({ path: path.join(outsidePath, 'secret.txt') })
    expect(result).toMatchObject({ ok: false, error: AGENT_POLICY_BLOCKED })
  })
})
