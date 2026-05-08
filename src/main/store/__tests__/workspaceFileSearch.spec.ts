import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { searchWorkspaceFiles } from '../workspaceFileSearch'

describe('searchWorkspaceFiles', () => {
  let workspacePath: string

  beforeEach(async () => {
    workspacePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-chat-workspace-files-'))
    await fs.promises.mkdir(path.join(workspacePath, 'src'), { recursive: true })
    await fs.promises.mkdir(path.join(workspacePath, 'node_modules/pkg'), { recursive: true })
    await fs.promises.mkdir(path.join(workspacePath, '.git'), { recursive: true })
    await fs.promises.writeFile(path.join(workspacePath, 'src/a.ts'), 'a')
    await fs.promises.writeFile(path.join(workspacePath, 'README.md'), 'readme')
    await fs.promises.writeFile(path.join(workspacePath, 'node_modules/pkg/index.ts'), 'ignored')
    await fs.promises.writeFile(path.join(workspacePath, '.git/config'), 'ignored')
  })

  afterEach(async () => {
    await fs.promises.rm(workspacePath, { recursive: true, force: true })
  })

  it('搜索工作区文件并跳过忽略目录', async () => {
    const results = await searchWorkspaceFiles(workspacePath, '', 20)
    const paths = results.map(item => item.path)

    expect(paths).toContain('README.md')
    expect(paths).toContain('src/a.ts')
    expect(paths).not.toContain('node_modules/pkg/index.ts')
    expect(paths).not.toContain('.git/config')
  })

  it('按相对路径查询并限制结果数量', async () => {
    const results = await searchWorkspaceFiles(workspacePath, 'src', 1)

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ path: 'src/a.ts', name: 'a.ts', type: 'file' })
  })
})
