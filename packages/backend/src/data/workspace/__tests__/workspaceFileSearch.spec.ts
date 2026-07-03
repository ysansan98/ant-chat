import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { searchWorkspaceFiles } from '../workspaceFileSearch'

/**
 * 行为驱动测试：模拟真实 monorepo 结构，覆盖用户真实钻取路径。
 *
 * 测试目录结构：
 * ```
 * workspace/
 * ├── README.md
 * ├── package.json
 * ├── src/                      # 应用源码
 * │   ├── app.ts
 * │   └── components/
 * │       └── Button.tsx
 * ├── packages/                 # workspace packages
 * │   ├── shared/               # 有源码的 package
 * │   │   └── src/
 * │   │       └── index.ts
 * │   └── built-pkg/            # 只有构建产物的 package（无源码）
 * │       ├── dist/
 * │       │   └── index.js
 * │       └── node_modules/
 * │           └── dep/index.js
 * ├── node_modules/             # 根级依赖（应被忽略）
 * │   └── react/index.js
 * └── .git/                     # 应被忽略
 *     └── config
 * ```
 *
 * 这个结构刻意包含了「只有构建产物的 package」（built-pkg），
 * 用于覆盖用户真实场景：钻取到此类目录时应返回空，而非报错或泄漏构建产物。
 */
describe('searchWorkspaceFiles', () => {
  let workspacePath: string

  beforeEach(async () => {
    workspacePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-chat-workspace-files-'))

    // 应用源码
    await fs.promises.mkdir(path.join(workspacePath, 'src/components'), { recursive: true })
    await fs.promises.writeFile(path.join(workspacePath, 'src/app.ts'), 'app')
    await fs.promises.writeFile(path.join(workspacePath, 'src/components/Button.tsx'), 'btn')

    // 有源码的 workspace package
    await fs.promises.mkdir(path.join(workspacePath, 'packages/shared/src'), { recursive: true })
    await fs.promises.writeFile(path.join(workspacePath, 'packages/shared/src/index.ts'), 'idx')

    // 只有构建产物的 package（dist 与 node_modules 均应被忽略）
    await fs.promises.mkdir(path.join(workspacePath, 'packages/built-pkg/dist'), { recursive: true })
    await fs.promises.mkdir(path.join(workspacePath, 'packages/built-pkg/node_modules/dep'), { recursive: true })
    await fs.promises.writeFile(path.join(workspacePath, 'packages/built-pkg/dist/index.js'), 'built')
    await fs.promises.writeFile(path.join(workspacePath, 'packages/built-pkg/node_modules/dep/index.js'), 'dep')

    // 根级文件
    await fs.promises.writeFile(path.join(workspacePath, 'README.md'), 'readme')
    await fs.promises.writeFile(path.join(workspacePath, 'package.json'), '{}')

    // 应被忽略的根级目录
    await fs.promises.mkdir(path.join(workspacePath, 'node_modules/react'), { recursive: true })
    await fs.promises.writeFile(path.join(workspacePath, 'node_modules/react/index.js'), 'react')
    await fs.promises.mkdir(path.join(workspacePath, '.git'), { recursive: true })
    await fs.promises.writeFile(path.join(workspacePath, '.git/config'), 'cfg')
  })

  afterEach(async () => {
    await fs.promises.rm(workspacePath, { recursive: true, force: true })
  })

  it('用户输入 @ 浏览根目录时，被忽略目录作为入口出现但不泄漏内部文件', async () => {
    const results = await searchWorkspaceFiles(workspacePath, '', 50)
    const paths = results.map(item => item.path)

    // 顶层目录与文件可见
    expect(paths).toContain('src')
    expect(paths).toContain('packages')
    expect(paths).toContain('README.md')
    expect(paths).toContain('package.json')

    // 被忽略目录作为可钻取入口出现（directory 类型）
    expect(results.find(item => item.path === 'node_modules')).toMatchObject({ type: 'directory' })
    expect(results.find(item => item.path === '.git')).toMatchObject({ type: 'directory' })

    // 但不自动下钻，内部文件不泄漏
    expect(paths).not.toContain('node_modules/react')
    expect(paths).not.toContain('node_modules/react/index.js')
    expect(paths).not.toContain('.git/config')
  })

  it('用户按文件名搜索时返回匹配文件并限制数量', async () => {
    const results = await searchWorkspaceFiles(workspacePath, 'app', 50)
    const paths = results.map(item => item.path)

    expect(paths).toContain('src/app.ts')

    // limit 生效
    const limited = await searchWorkspaceFiles(workspacePath, '', 1)
    expect(limited).toHaveLength(1)
  })

  it('结果中目录排在文件之前，便于用户先钻取再选文件', async () => {
    const results = await searchWorkspaceFiles(workspacePath, '', 50)
    const paths = results.map(item => item.path)

    const srcDirIndex = paths.indexOf('src')
    const readmeIndex = paths.indexOf('README.md')
    expect(srcDirIndex).toBeGreaterThanOrEqual(0)
    expect(readmeIndex).toBeGreaterThan(srcDirIndex)
  })

  it('用户输入目录名（不带尾斜杠）时，作为模糊搜索匹配该目录与其下内容', async () => {
    // 模拟：用户输入 @src，应把 src 本身作为目录项列出，同时列出 path 含 src 的文件
    const results = await searchWorkspaceFiles(workspacePath, 'src', 50)
    const paths = results.map(item => item.path)

    // src 目录自身出现，便于用户点选补全为 @src/
    expect(paths).toContain('src')

    // src 下的文件命中
    expect(paths).toContain('src/app.ts')
    expect(paths).toContain('src/components/Button.tsx')
  })

  it('用户钻取到只有构建产物的目录时，构建目录作为入口出现', async () => {
    // 模拟：用户 @packages → 选 packages → @packages/ → 选 built-pkg → @packages/built-pkg/
    // built-pkg 下只有 dist 与 node_modules，它们作为可钻取入口出现
    const results = await searchWorkspaceFiles(workspacePath, 'packages/built-pkg/', 50)
    const paths = results.map(item => item.path)

    // 构建目录作为入口出现，用户可继续主动钻取
    expect(results.find(item => item.path === 'packages/built-pkg/dist')).toMatchObject({ type: 'directory' })
    expect(results.find(item => item.path === 'packages/built-pkg/node_modules')).toMatchObject({ type: 'directory' })

    // 但不自动下钻，构建产物文件不泄漏
    expect(paths).not.toContain('packages/built-pkg/dist/index.js')
    expect(paths).not.toContain('packages/built-pkg/node_modules/dep/index.js')
  })

  it('用户在目录内输入关键词时，模糊匹配子孙目录与文件', async () => {
    // 模拟：用户 @packages → 选 packages → @packages/ → 输入 sh → @packages/sh
    // shared 的 basename 含 'sh'，应命中；其下文件路径含 'sh' 也应命中
    const results = await searchWorkspaceFiles(workspacePath, 'packages/sh', 50)
    const paths = results.map(item => item.path)

    expect(paths).toContain('packages/shared')
    expect(paths).toContain('packages/shared/src/index.ts')
  })

  it('用户连续钻取多层目录，每层都能看到对应内容', async () => {
    // 第一层：packages/ → 看到 shared 与 built-pkg 目录
    const level1 = await searchWorkspaceFiles(workspacePath, 'packages/', 50)
    const level1Paths = level1.map(item => item.path)
    expect(level1Paths).toContain('packages/shared')
    expect(level1Paths).toContain('packages/built-pkg')

    // 第二层：packages/shared/ → 看到 src 目录
    const level2 = await searchWorkspaceFiles(workspacePath, 'packages/shared/', 50)
    expect(level2.find(item => item.path === 'packages/shared/src')).toMatchObject({ type: 'directory' })

    // 第三层：packages/shared/src/ → 看到 index.ts 文件
    const level3 = await searchWorkspaceFiles(workspacePath, 'packages/shared/src/', 50)
    const level3Paths = level3.map(item => item.path)
    expect(level3Paths).toContain('packages/shared/src/index.ts')
  })

  it('用户主动进入被忽略目录时，正常看到其下内容', async () => {
    // 进入 dist 构建产物目录 → 看到 index.js 文件
    const distResults = await searchWorkspaceFiles(workspacePath, 'packages/built-pkg/dist/', 50)
    const distPaths = distResults.map(item => item.path)
    expect(distPaths).toContain('packages/built-pkg/dist/index.js')

    // 进入 node_modules → 看到 react 子目录及其下文件
    // react 本身不在 IGNORED_DIRS，用户主动进入 node_modules 后其内容正常浏览
    const nmResults = await searchWorkspaceFiles(workspacePath, 'node_modules/', 50)
    const nmPaths = nmResults.map(item => item.path)
    expect(nmResults.find(item => item.path === 'node_modules/react')).toMatchObject({ type: 'directory' })
    expect(nmPaths).toContain('node_modules/react/index.js')
  })

  it('目录子限额不挤占文件名额，limit 较小时仍返回文件', async () => {
    // 根目录有 src、packages、node_modules、.git 四个目录，limit=5 时应返回 4 目录 + 1 文件
    const results = await searchWorkspaceFiles(workspacePath, '', 5)
    expect(results).toHaveLength(5)
    expect(results[0].type).toBe('directory')
    expect(results[1].type).toBe('directory')
    expect(results[2].type).toBe('directory')
    expect(results[3].type).toBe('directory')
    expect(results[4].type).toBe('file')
  })
})
