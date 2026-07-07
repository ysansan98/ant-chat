import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillManagementService } from '../skillManagementService'

const VALID_SKILL_ZIP = 'UEsDBBQAAAAIAK1YnlxVUSklIgAAACQAAAAIAAAAU0tJTEwubWRTVggvyixJLeLiAtMKxRn5RSUKRak5qYnFqQp5+SWpxXoAUEsBAhQAFAAAAAgArVieXFVRKSUiAAAAJAAAAAgAAAAAAAAAAAAAAAAAAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAEgAAAAAAA=='
const UNSAFE_SKILL_ZIP = 'UEsDBBQAAAAIAK9Ynly7JMeZCgAAAAgAAAALAAAALi4vU0tJTEwubWRTVgjNK05MSwUAUEsBAhQAFAAAAAgAr1ieXLskx5kKAAAACAAAAAsAAAAAAAAAAAAAAAAAAAAAAC4uL1NLSUxMLm1kUEsFBgAAAAABAAEAOQAAADMAAAAAAA=='
const FRONTMATTER_SKILL_ZIP = 'UEsDBBQAAAAAAHx8plzIj6ltcwAAAHMAAAAIAAAAU0tJTEwubWQtLS0KbmFtZToga2FtaQpkZXNjcmlwdGlvbjogVHlwZXNldCBwcm9mZXNzaW9uYWwgZG9jdW1lbnRzLgotLS0KCiMga2FtaSDCtyDntJkKCldyaXRlIHByb2Zlc3Npb25hbCBQREZzIHdpdGgga2FtaS4KUEsBAhQDFAAAAAAAfHymXMiPqW1zAAAAcwAAAAgAAAAAAAAAAAAAAIABAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAJkAAAAAAA=='

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
    expect(index.skills).toHaveLength(2)
    expect(index.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'skill-installer', source: 'builtin', enabled: true, builtin: true }),
      expect.objectContaining({ name: 'ant-chat-manager', source: 'builtin', enabled: true, builtin: true }),
    ]))
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
    const zipPath = path.join(homeDir, 'writer.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(VALID_SKILL_ZIP, 'base64'))

    await reader.importFromZip(zipPath)

    const manifestPath = path.join(skillsRoot, 'writer', 'manifest.json')
    expect(fs.existsSync(manifestPath)).toBe(false)
  })

  it('导入 skill zip 并读取已安装 markdown', async () => {
    const zipPath = path.join(homeDir, 'writer.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(VALID_SKILL_ZIP, 'base64'))

    const manifest = await reader.importFromZip(zipPath)
    const index = await reader.listSkills()
    const markdown = await reader.readSkillMarkdown('writer')

    expect(manifest).toMatchObject({
      name: 'writer',
      source: 'zip',
      enabled: true,
    })
    expect(index.skills.map(item => item.name)).toEqual(['ant-chat-manager', 'skill-installer', 'writer'])
    expect(markdown).toContain('Write short release notes.')
  })

  it('拒绝包含不安全路径的 zip entry', async () => {
    const zipPath = path.join(homeDir, 'unsafe.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(UNSAFE_SKILL_ZIP, 'base64'))

    await expect(reader.importFromZip(zipPath)).rejects.toThrow('unsafe zip path')
  })

  it('使用 SKILL.md frontmatter 作为元数据来源', async () => {
    const zipPath = path.join(homeDir, 'kami-test.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(FRONTMATTER_SKILL_ZIP, 'base64'))

    const manifest = await reader.importFromZip(zipPath)

    // name 会被规范化为与目录名一致
    expect(manifest.name).toBe('kami')
    expect(manifest.description).toBe('Typeset professional documents.')

    const markdown = await reader.readSkillMarkdown('kami')
    expect(markdown).toContain('# kami · 紙')
  })

  it('setEnabled 更新 .index.json 而不修改 SKILL.md', async () => {
    const zipPath = path.join(homeDir, 'writer.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(VALID_SKILL_ZIP, 'base64'))
    await reader.importFromZip(zipPath)

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
    const zipPath = path.join(homeDir, 'writer.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(VALID_SKILL_ZIP, 'base64'))
    await reader.importFromZip(zipPath)

    await reader.deleteSkill('writer')

    expect(fs.existsSync(path.join(skillsRoot, 'writer'))).toBe(false)
    const index = await reader.listSkills()
    expect(index.skills.map(item => item.name)).toEqual(['ant-chat-manager', 'skill-installer'])
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
    expect(manual!.source).toBe('zip')
  })
})
