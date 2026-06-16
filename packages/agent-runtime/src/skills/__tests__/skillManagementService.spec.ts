import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SkillManagementService } from '../skillManagementService'

const VALID_SKILL_ZIP = 'UEsDBBQAAAAIAK1YnlxVUSklIgAAACQAAAAIAAAAU0tJTEwubWRTVggvyixJLeLiAtMKxRn5RSUKRak5qYnFqQp5+SWpxXoAUEsBAhQAFAAAAAgArVieXFVRKSUiAAAAJAAAAAgAAAAAAAAAAAAAAAAAAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAEgAAAAAAA=='
const UNSAFE_SKILL_ZIP = 'UEsDBBQAAAAIAK9Ynly7JMeZCgAAAAgAAAALAAAALi4vU0tJTEwubWRTVgjNK05MSwUAUEsBAhQAFAAAAAgAr1ieXLskx5kKAAAACAAAAAsAAAAAAAAAAAAAAAAAAAAAAC4uL1NLSUxMLm1kUEsFBgAAAAABAAEAOQAAADMAAAAAAA=='
const FRONTMATTER_SKILL_ZIP = 'UEsDBBQAAAAAAHx8plzIj6ltcwAAAHMAAAAIAAAAU0tJTEwubWQtLS0KbmFtZToga2FtaQpkZXNjcmlwdGlvbjogVHlwZXNldCBwcm9mZXNzaW9uYWwgZG9jdW1lbnRzLgotLS0KCiMga2FtaSDCtyDntJkKCldyaXRlIHByb2Zlc3Npb25hbCBQREZzIHdpdGgga2FtaS4KUEsBAhQDFAAAAAAAfHymXMiPqW1zAAAAcwAAAAgAAAAAAAAAAAAAAIABAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAJkAAAAAAA=='

describe('skillFsReader 行为', () => {
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

  it('初始化内置 skill-installer 并重建索引', async () => {
    const index = await reader.listSkills()

    expect(index.rootPath).toBe(skillsRoot)
    expect(index.skills).toHaveLength(1)
    expect(index.skills[0]).toMatchObject({
      name: 'skill-installer',
      source: 'builtin',
      enabled: true,
      builtin: true,
    })
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
      description: 'Write short release notes.',
    })
    expect(index.skills.map(item => item.name)).toEqual(['skill-installer', 'writer'])
    expect(markdown).toContain('Write short release notes.')
  })

  it('拒绝包含不安全路径的 zip entry', async () => {
    const zipPath = path.join(homeDir, 'unsafe.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(UNSAFE_SKILL_ZIP, 'base64'))

    await expect(reader.importFromZip(zipPath)).rejects.toThrow('unsafe zip path')
  })

  it('没有 manifest.json 时使用 SKILL.md frontmatter name 而不是标题', async () => {
    const zipPath = path.join(homeDir, 'kami-test.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(FRONTMATTER_SKILL_ZIP, 'base64'))

    const manifest = await reader.importFromZip(zipPath)

    expect(manifest.name).toBe('kami')
    expect(manifest.description).toBe('Typeset professional documents.')

    const markdown = await reader.readSkillMarkdown('kami')
    expect(markdown).toContain('# kami · 紙')
  })
})
