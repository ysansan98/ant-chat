import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getWorkspaceFileForStream, listDirectoryEntries, readTextFile, resolveWorkspaceFilePath } from '../workspaceFileTree'

const MAX_PREVIEW_BYTES = 1024 * 1024

describe('workspaceFileTree', () => {
  let workspacePath: string
  let outsideDir: string

  beforeEach(async () => {
    workspacePath = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-chat-tree-ws-'))
    outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-chat-tree-out-'))
    await fs.promises.mkdir(path.join(workspacePath, 'src/components'), { recursive: true })
    await fs.promises.writeFile(path.join(workspacePath, 'src/app.ts'), 'app')
    await fs.promises.writeFile(path.join(workspacePath, 'src/components/Button.tsx'), 'btn')
    await fs.promises.writeFile(path.join(workspacePath, 'README.md'), 'readme')
    await fs.promises.writeFile(path.join(workspacePath, 'package.json'), '{}')
    // 媒体预览测试文件
    await fs.promises.writeFile(path.join(workspacePath, 'logo.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]))
    await fs.promises.writeFile(path.join(workspacePath, 'demo.mp4'), Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]))
    await fs.promises.writeFile(path.join(workspacePath, 'data.xlsx'), Buffer.from([0x50, 0x4B, 0x03, 0x04]))
  })

  afterEach(async () => {
    await fs.promises.rm(workspacePath, { force: true, recursive: true })
    await fs.promises.rm(outsideDir, { force: true, recursive: true })
  })

  it('根目录列出直接子条目：目录在前，文件在后，各自按名称排序', async () => {
    const result = await listDirectoryEntries(workspacePath)

    expect(result.dirs).toEqual([{ name: 'src', relPath: 'src', type: 'directory' }])
    expect(result.files.map(file => file.name)).toEqual(['data.xlsx', 'demo.mp4', 'logo.png', 'package.json', 'README.md'])
    expect(result.files[4]).toEqual({ name: 'README.md', relPath: 'README.md', type: 'file' })
  })

  it('子目录枚举返回嵌套 relPath', async () => {
    const result = await listDirectoryEntries(workspacePath, 'src')

    expect(result.dirs.map(dir => dir.relPath)).toEqual(['src/components'])
    expect(result.files.map(file => file.relPath)).toEqual(['src/app.ts'])
  })

  it('拒绝 .. 与绝对路径', async () => {
    await expect(listDirectoryEntries(workspacePath, '../outside')).rejects.toThrow('路径超出工作区范围')
    await expect(listDirectoryEntries(workspacePath, '/etc')).rejects.toThrow('路径超出工作区范围')
    await expect(readTextFile(workspacePath, '../../etc/passwd')).rejects.toThrow('路径超出工作区范围')
    await expect(readTextFile(workspacePath, '/etc/passwd')).rejects.toThrow('路径超出工作区范围')
  })

  it('符号链接逃逸工作区的目录从枚举中剔除', async () => {
    await fs.promises.symlink(outsideDir, path.join(workspacePath, 'escape-link'), 'dir')

    const result = await listDirectoryEntries(workspacePath)
    expect(result.dirs.some(dir => dir.name === 'escape-link')).toBe(false)
  })

  it('符号链接逃逸工作区的文件不可读取', async () => {
    await fs.promises.writeFile(path.join(outsideDir, 'secret.txt'), 'secret')
    await fs.promises.symlink(path.join(outsideDir, 'secret.txt'), path.join(workspacePath, 'link.txt'), 'file')

    await expect(readTextFile(workspacePath, 'link.txt')).rejects.toThrow('路径超出工作区范围')
  })

  it('resolveWorkspaceFilePath 返回工作区内真实路径', async () => {
    // macOS 下 /var 是 /private/var 的符号链接，解析结果以 realpath 为准
    const rootReal = fs.realpathSync.native(workspacePath)
    const resolved = resolveWorkspaceFilePath(workspacePath, 'src/app.ts')
    expect(resolved).toBe(path.join(rootReal, 'src/app.ts'))
    expect(resolveWorkspaceFilePath(workspacePath, 'README.md')).toBe(path.join(rootReal, 'README.md'))
  })

  it('resolveWorkspaceFilePath 拒绝越界与不存在的路径', () => {
    expect(() => resolveWorkspaceFilePath(workspacePath, '../outside')).toThrow('路径超出工作区范围')
    expect(() => resolveWorkspaceFilePath(workspacePath, '/etc/passwd')).toThrow('路径超出工作区范围')
    expect(() => resolveWorkspaceFilePath(workspacePath, 'missing.txt')).toThrow('文件不存在')
  })

  it('指向工作区内的符号链接保留自身名字，不与目标文件 relPath 撞车', async () => {
    await fs.promises.symlink('README.md', path.join(workspacePath, 'LINK.md'), 'file')

    const result = await listDirectoryEntries(workspacePath)
    const relPaths = [
      ...result.dirs.map(dir => dir.relPath),
      ...result.files.map(file => file.relPath),
    ]
    expect(new Set(relPaths).size).toBe(relPaths.length)
    expect(result.files.some(file => file.name === 'LINK.md' && file.relPath === 'LINK.md')).toBe(true)
    expect(result.files.filter(file => file.relPath === 'README.md')).toHaveLength(1)
  })

  it('读取文本文件成功返回内容与大小', async () => {
    await expect(readTextFile(workspacePath, 'README.md')).resolves.toEqual({
      content: 'readme',
      size: 6,
    })
  })

  it('超过 1MB 的文件拒绝预览', async () => {
    await fs.promises.writeFile(path.join(workspacePath, 'big.txt'), Buffer.alloc(MAX_PREVIEW_BYTES + 1, 0x61))

    await expect(readTextFile(workspacePath, 'big.txt')).rejects.toThrow('文件超过 1MB')
  })

  it('文件头含 NUL 字节的二进制文件拒绝预览', async () => {
    await fs.promises.writeFile(path.join(workspacePath, 'image.png'), Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x00, 0x01]))

    await expect(readTextFile(workspacePath, 'image.png')).rejects.toThrow('二进制文件无法预览')
  })

  it('不存在的文件抛明确错误', async () => {
    await expect(readTextFile(workspacePath, 'missing.txt')).rejects.toThrow('文件不存在')
  })

  it('对目录调用读取抛路径不是文件', async () => {
    await expect(readTextFile(workspacePath, 'src')).rejects.toThrow('路径不是文件')
  })

  describe('getWorkspaceFileForStream', () => {
    it('返回已校验的绝对路径、大小与 MIME 类型', async () => {
      const rootReal = fs.realpathSync.native(workspacePath)

      const png = await getWorkspaceFileForStream(workspacePath, 'logo.png')
      expect(png.absolutePath).toBe(path.join(rootReal, 'logo.png'))
      expect(png.size).toBe(6)
      expect(png.mediaType).toBe('image/png')

      const mp4 = await getWorkspaceFileForStream(workspacePath, 'demo.mp4')
      expect(mp4.mediaType).toBe('video/mp4')

      const xlsx = await getWorkspaceFileForStream(workspacePath, 'data.xlsx')
      expect(xlsx.mediaType).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

      // 未知扩展名回退 octet-stream
      const txt = await getWorkspaceFileForStream(workspacePath, 'README.md')
      expect(txt.mediaType).toBe('application/octet-stream')
    })

    it('拒绝 .. 与绝对路径', async () => {
      await expect(getWorkspaceFileForStream(workspacePath, '../outside')).rejects.toThrow('路径超出工作区范围')
      await expect(getWorkspaceFileForStream(workspacePath, '/etc/passwd')).rejects.toThrow('路径超出工作区范围')
      await expect(getWorkspaceFileForStream(workspacePath, '../../etc/passwd')).rejects.toThrow('路径超出工作区范围')
    })

    it('符号链接逃逸工作区的文件不可流式预览', async () => {
      await fs.promises.writeFile(path.join(outsideDir, 'secret.txt'), 'secret')
      await fs.promises.symlink(path.join(outsideDir, 'secret.txt'), path.join(workspacePath, 'link.txt'), 'file')

      await expect(getWorkspaceFileForStream(workspacePath, 'link.txt')).rejects.toThrow('路径超出工作区范围')
    })

    it('不存在的文件抛明确错误', async () => {
      await expect(getWorkspaceFileForStream(workspacePath, 'missing.png')).rejects.toThrow('文件不存在')
    })

    it('对目录调用抛路径不是文件', async () => {
      await expect(getWorkspaceFileForStream(workspacePath, 'src')).rejects.toThrow('路径不是文件')
    })

    it('空 relPath 抛路径超出工作区范围', async () => {
      await expect(getWorkspaceFileForStream(workspacePath, '')).rejects.toThrow('路径超出工作区范围')
    })
  })
})
