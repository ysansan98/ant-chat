import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { SkillManagementService } from '../skillManagementService'

const VALID_SKILL_ZIP = 'UEsDBBQAAAAIAK1YnlxVUSklIgAAACQAAAAIAAAAU0tJTEwubWRTVggvyixJLeLiAtMKxRn5RSUKRak5qYnFqQp5+SWpxXoAUEsBAhQAFAAAAAgArVieXFVRKSUiAAAAJAAAAAgAAAAAAAAAAAAAAAAAAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAEgAAAAAAA=='
const UNSAFE_SKILL_ZIP = 'UEsDBBQAAAAIAK9Ynly7JMeZCgAAAAgAAAALAAAALi4vU0tJTEwubWRTVgjNK05MSwUAUEsBAhQAFAAAAAgAr1ieXLskx5kKAAAACAAAAAsAAAAAAAAAAAAAAAAAAAAAAC4uL1NLSUxMLm1kUEsFBgAAAAABAAEAOQAAADMAAAAAAA=='
const FRONTMATTER_SKILL_ZIP = 'UEsDBBQAAAAAAHx8plzIj6ltcwAAAHMAAAAIAAAAU0tJTEwubWQtLS0KbmFtZToga2FtaQpkZXNjcmlwdGlvbjogVHlwZXNldCBwcm9mZXNzaW9uYWwgZG9jdW1lbnRzLgotLS0KCiMga2FtaSDCtyDntJkKCldyaXRlIHByb2Zlc3Npb25hbCBQREZzIHdpdGgga2FtaS4KUEsBAhQDFAAAAAAAfHymXMiPqW1zAAAAcwAAAAgAAAAAAAAAAAAAAIABAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAJkAAAAAAA=='

/** 构造 codeload 风格的 github zip：仓库目录前缀 + 多个文件。 */
function githubArchiveZip(entries: Record<string, string>): string {
  const files: Record<string, Uint8Array> = {}
  for (const [entryPath, content] of Object.entries(entries)) {
    files[entryPath] = strToU8(content)
  }
  return Buffer.from(zipSync(files)).toString('base64')
}

function skillMarkdown(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
}

describe('skillManagementService', () => {
  let homeDir: string
  let skillsRoot: string
  let reader: SkillManagementService

  beforeEach(async () => {
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-chat-skill-test-'))
    skillsRoot = path.join(homeDir, '.ant-chat', 'skills')
    reader = new SkillManagementService({ skillsRoot })
  })

  afterEach(async () => {
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it('初始化内置 skill-installer 并从 frontmatter 读取元数据', async () => {
    const index = await reader.listSkills()

    expect(index.rootPath).toBe(skillsRoot)
    expect(index.skills).toHaveLength(4)
    expect(index.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'skill-installer', source: 'builtin', enabled: true, builtin: true }),
      expect.objectContaining({ name: 'ant-chat-manager', source: 'builtin', enabled: true, builtin: true }),
      expect.objectContaining({ name: 'visualize', source: 'builtin', enabled: true, builtin: true }),
      expect.objectContaining({ name: 'image-recognition', source: 'builtin', enabled: true, builtin: true }),
    ]))
  })

  it('并发读取 skill 列表时只执行一次初始化复制', async () => {
    const results = await Promise.all(Array.from({ length: 12 }, () => reader.listSkills()))

    expect(results).toHaveLength(12)
    expect(await fs.promises.readFile(path.join(skillsRoot, 'visualize', 'SKILL.md'), 'utf8')).toContain('name: visualize')
  })

  it('初始化时递归复制 visualize 的 references 子目录', async () => {
    await reader.ensureInitialized()

    const referencesRoot = path.join(skillsRoot, 'visualize', 'references')
    const files = await fs.promises.readdir(referencesRoot)
    expect(files.sort()).toEqual(['visualization-contract.md', 'visualization-design.md', 'visualization-schema.md'])
  })

  it('内置 skill-installer 的 SKILL.md 包含正确的 YAML frontmatter', async () => {
    await reader.ensureInitialized()

    const skillFile = path.join(skillsRoot, 'skill-installer', 'SKILL.md')
    const content = await fs.promises.readFile(skillFile, 'utf8')

    expect(content).toMatch(/^---\n/)
    expect(content).toContain('name: skill-installer')
    expect(content).toContain('description: Install and manage Ant Chat skills from GitHub.')
    expect(content).toContain('# Skill Installer')
  })

  it('导入 skill zip 后不创建 manifest.json', async () => {
    await reader.importSkill({ source: 'zip', zipBase64: VALID_SKILL_ZIP })

    const manifestPath = path.join(skillsRoot, 'writer', 'manifest.json')
    expect(fs.existsSync(manifestPath)).toBe(false)
  })

  it('导入 skill zip 并读取已安装 markdown', async () => {
    const manifest = await reader.importSkill({ source: 'zip', zipBase64: VALID_SKILL_ZIP })
    const index = await reader.listSkills()
    const markdown = await reader.readSkillMarkdown('writer')

    expect(manifest).toMatchObject({
      name: 'writer',
      source: 'zip',
      enabled: true,
    })
    expect(index.skills.map(item => item.name)).toEqual(['ant-chat-manager', 'image-recognition', 'skill-installer', 'visualize', 'writer'])
    expect(markdown).toContain('Write short release notes.')
  })

  it('gitHub 导入把分支解析为 commit 哈希并持久化', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/commits/main')) {
        return { ok: true, json: async () => ({ sha: 'abc123def456' }) } as unknown as Response
      }
      if (url.includes('/zip/abc123def456')) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(githubArchiveZip({
            'writer-main/SKILL.md': skillMarkdown('writer', 'Write short release notes.'),
          }), 'base64'),
        } as unknown as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const manifest = await reader.importSkill({
        source: 'github',
        url: 'https://github.com/acme/writer/tree/main',
      })

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.github.com/repos/acme/writer/commits/main',
      )
      expect(fetchMock).toHaveBeenCalledWith(
        'https://codeload.github.com/acme/writer/zip/abc123def456',
      )
      expect(manifest).toMatchObject({
        name: 'writer',
        source: 'github',
        sourceUrl: 'https://github.com/acme/writer/tree/main',
        commitSha: 'abc123def456',
      })
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('gitHub 导入解析不了 commit 时显式失败', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('/commits/main')) {
        return { ok: false, status: 404 } as unknown as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      await expect(reader.importSkill({
        source: 'github',
        url: 'https://github.com/acme/writer/tree/main',
      })).rejects.toThrow('failed to resolve commit')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('github 预览只扫描仓库根与 skills/ 容器，跳过其他目录', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/acme/writer') {
        return { ok: true, json: async () => ({ default_branch: 'main' }) } as unknown as Response
      }
      if (url.includes('/zip/main')) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(githubArchiveZip({
            'writer-main/SKILL.md': skillMarkdown('writer', 'Write release notes.'),
            'writer-main/skills/engineering/code-review/SKILL.md': skillMarkdown('code-review', 'Review code.'),
            'writer-main/skills/productivity/todo/SKILL.md': skillMarkdown('todo', 'Track todos.'),
            'writer-main/skills/in-progress/writing-beats/SKILL.md': skillMarkdown('writing-beats', 'Write beats.'),
            'writer-main/docs/guide/SKILL.md': skillMarkdown('guide', 'Docs only.'),
            'writer-main/node_modules/pkg/SKILL.md': skillMarkdown('pkg', 'Dependency.'),
          }), 'base64'),
        } as unknown as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const previews = await reader.previewGithubSkills('https://github.com/acme/writer')

      expect(previews.map(item => item.path)).toEqual([
        '',
        'skills/engineering/code-review',
        'skills/in-progress/writing-beats',
        'skills/productivity/todo',
      ])
      expect(previews.find(item => item.path === 'skills/engineering/code-review')).toMatchObject({
        name: 'code-review',
        category: 'engineering',
        description: 'Review code.',
      })
      expect(previews.find(item => item.path === '')?.name).toBe('writer')
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('github 批量导入选中的 skill，重名的跳过并汇报', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === 'https://api.github.com/repos/acme/writer') {
        return { ok: true, json: async () => ({ default_branch: 'main' }) } as unknown as Response
      }
      if (url.includes('/commits/main')) {
        return { ok: true, json: async () => ({ sha: 'abc123def456' }) } as unknown as Response
      }
      if (url.includes('/zip/abc123def456')) {
        return {
          ok: true,
          arrayBuffer: async () => Buffer.from(githubArchiveZip({
            'writer-main/skills/engineering/code-review/SKILL.md': skillMarkdown('code-review', 'Review code.'),
            'writer-main/skills/productivity/todo/SKILL.md': skillMarkdown('todo', 'Track todos.'),
          }), 'base64'),
        } as unknown as Response
      }
      throw new Error(`unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    try {
      const url = 'https://github.com/acme/writer'
      await reader.importGithubSkills(url, ['skills/engineering/code-review'])

      const result = await reader.importGithubSkills(url, [
        'skills/engineering/code-review',
        'skills/productivity/todo',
      ])

      expect(result.installed.map(item => item.name)).toEqual(['todo'])
      expect(result.skipped).toEqual(['skills/engineering/code-review'])
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('拒绝包含不安全路径的 zip entry', async () => {
    await expect(reader.importSkill({ source: 'zip', zipBase64: UNSAFE_SKILL_ZIP })).rejects.toThrow('unsafe zip path')
  })

  it('使用 SKILL.md frontmatter 作为元数据来源', async () => {
    const manifest = await reader.importSkill({ source: 'zip', zipBase64: FRONTMATTER_SKILL_ZIP })

    // name 会被规范化为与目录名一致
    expect(manifest.name).toBe('kami')
    expect(manifest.description).toBe('Typeset professional documents.')

    const markdown = await reader.readSkillMarkdown('kami')
    expect(markdown).toContain('# kami · 紙')
  })

  it('setEnabled 更新 .index.json 而不修改 SKILL.md', async () => {
    await reader.importSkill({ source: 'zip', zipBase64: VALID_SKILL_ZIP })

    const skillFile = path.join(skillsRoot, 'writer', 'SKILL.md')
    const before = await fs.promises.readFile(skillFile, 'utf8')

    await reader.setEnabled('writer', false)

    const after = await fs.promises.readFile(skillFile, 'utf8')
    expect(before).toBe(after)

    const index = await reader.listSkills()
    const writer = index.skills.find(s => s.name === 'writer')!
    expect(writer.enabled).toBe(false)
  })

  it('deleteSkill 删除目录并从 .index.json 移除', async () => {
    await reader.importSkill({ source: 'zip', zipBase64: VALID_SKILL_ZIP })

    await reader.deleteSkill('writer')

    expect(fs.existsSync(path.join(skillsRoot, 'writer'))).toBe(false)
    const index = await reader.listSkills()
    expect(index.skills.map(item => item.name)).toEqual(['ant-chat-manager', 'image-recognition', 'skill-installer', 'visualize'])
  })

  it('.index.json 使用新版格式（version: 1, skills map）', async () => {
    await reader.listSkills()

    const indexPath = path.join(skillsRoot, '.index.json')
    const data = JSON.parse(await fs.promises.readFile(indexPath, 'utf8'))

    expect(data.version).toBe(1)
    expect(data.skills).toBeDefined()
    expect(data.skills['skill-installer']).toMatchObject({
      enabled: true,
      builtin: true,
      source: 'builtin',
    })
  })

  it('从旧版 manifest.json 格式迁移', async () => {
    // 创建旧格式的 skill 目录
    const skillDir = path.join(skillsRoot, 'old-skill')
    await fs.promises.mkdir(skillDir, { recursive: true })
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: old-skill\ndescription: An old skill.\n---\n\n# Old Skill\n')
    await fs.promises.writeFile(path.join(skillDir, 'manifest.json'), JSON.stringify({
      name: 'old-skill',
      description: 'An old skill.',
      source: 'github',
      sourceUrl: 'https://github.com/test/old-skill',
      enabled: true,
      builtin: false,
      installedAt: 1000,
      updatedAt: 2000,
    }))
    // 写旧格式 .index.json（数组）
    await fs.promises.writeFile(path.join(skillsRoot, '.index.json'), JSON.stringify([]))

    // 触发迁移
    const index = await reader.listSkills()

    // manifest.json 应被删除
    expect(fs.existsSync(path.join(skillDir, 'manifest.json'))).toBe(false)

    // 旧 skill 数据应被迁移
    const oldSkill = index.skills.find(s => s.name === 'old-skill')
    expect(oldSkill).toBeDefined()
    expect(oldSkill!.source).toBe('github')
    expect(oldSkill!.sourceUrl).toBe('https://github.com/test/old-skill')
    expect(oldSkill!.description).toBe('An old skill.')
    expect(oldSkill!.installedAt).toBe(1000)

    // .index.json 应为新版格式
    const newIndex = JSON.parse(await fs.promises.readFile(path.join(skillsRoot, '.index.json'), 'utf8'))
    expect(newIndex.version).toBe(1)
    expect(newIndex.skills['old-skill']).toBeDefined()
  })

  it('rebuildIndex 发现手动添加的 skill 目录', async () => {
    // 手动创建一个 skill 目录（不通过 importFromZip）
    const skillDir = path.join(skillsRoot, 'manual-skill')
    await fs.promises.mkdir(skillDir, { recursive: true })
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: manual-skill\ndescription: Manually added.\n---\n\n# Manual\n')

    const skills = await reader.rebuildIndex()

    const manual = skills.find(s => s.name === 'manual-skill')
    expect(manual).toBeDefined()
    expect(manual!.description).toBe('Manually added.')
    expect(manual!.enabled).toBe(true)
    expect(manual!.source).toBe('local')
  })
})
