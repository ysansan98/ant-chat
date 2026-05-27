import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const VALID_SKILL_ZIP = 'UEsDBBQAAAAIAK1YnlxVUSklIgAAACQAAAAIAAAAU0tJTEwubWRTVggvyixJLeLiAtMKxRn5RSUKRak5qYnFqQp5+SWpxXoAUEsBAhQAFAAAAAgArVieXFVRKSUiAAAAJAAAAAgAAAAAAAAAAAAAAAAAAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAEgAAAAAAA=='
const UNSAFE_SKILL_ZIP = 'UEsDBBQAAAAIAK9Ynly7JMeZCgAAAAgAAAALAAAALi4vU0tJTEwubWRTVgjNK05MSwUAUEsBAhQAFAAAAAgAr1ieXLskx5kKAAAACAAAAAsAAAAAAAAAAAAAAAAAAAAAAC4uL1NLSUxMLm1kUEsFBgAAAAABAAEAOQAAADMAAAAAAA=='
const FRONTMATTER_SKILL_ZIP = 'UEsDBBQAAAAAAHx8plzIj6ltcwAAAHMAAAAIAAAAU0tJTEwubWQtLS0KbmFtZToga2FtaQpkZXNjcmlwdGlvbjogVHlwZXNldCBwcm9mZXNzaW9uYWwgZG9jdW1lbnRzLgotLS0KCiMga2FtaSDCtyDntJkKCldyaXRlIHByb2Zlc3Npb25hbCBQREZzIHdpdGgga2FtaS4KUEsBAhQDFAAAAAAAfHymXMiPqW1zAAAAcwAAAAgAAAAAAAAAAAAAAIABAAAAAFNLSUxMLm1kUEsFBgAAAAABAAEANgAAAJkAAAAAAA=='

describe('skillManagementService', () => {
  let homeDir: string

  beforeEach(async () => {
    homeDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ant-chat-skill-test-'))
    vi.resetModules()
    vi.doMock('@main/utils/appPaths', () => ({
      getAppDataRoot: () => path.join(homeDir, '.ant-chat'),
    }))
  })

  afterEach(async () => {
    vi.resetModules()
    await fs.promises.rm(homeDir, { recursive: true, force: true })
  })

  it('initializes builtin skill installer and rebuilds index', async () => {
    const { skillManagementService } = await import('../skillManagementService')

    const index = await skillManagementService.listSkills()

    expect(index.rootPath).toBe(path.join(homeDir, '.ant-chat', 'skills'))
    expect(index.skills).toHaveLength(1)
    expect(index.skills[0]).toMatchObject({
      name: 'skill-installer',
      source: 'builtin',
      enabled: true,
      builtin: true,
    })
  })

  it('imports a skill zip and reads installed markdown', async () => {
    const { skillManagementService } = await import('../skillManagementService')
    const zipPath = path.join(homeDir, 'writer.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(VALID_SKILL_ZIP, 'base64'))

    const manifest = await skillManagementService.importFromZip(zipPath)
    const index = await skillManagementService.listSkills()
    const markdown = await skillManagementService.readSkillMarkdown('writer')

    expect(manifest).toMatchObject({
      name: 'writer',
      source: 'zip',
      enabled: true,
      description: 'Write short release notes.',
    })
    expect(index.skills.map(item => item.name)).toEqual(['skill-installer', 'writer'])
    expect(markdown).toContain('Write short release notes.')
  })

  it('rejects zip entries with unsafe paths', async () => {
    const { skillManagementService } = await import('../skillManagementService')
    const zipPath = path.join(homeDir, 'unsafe.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(UNSAFE_SKILL_ZIP, 'base64'))

    await expect(skillManagementService.importFromZip(zipPath)).rejects.toThrow('unsafe zip path')
  })

  it('uses frontmatter name instead of title for SKILL.md without manifest.json', async () => {
    const { skillManagementService } = await import('../skillManagementService')
    const zipPath = path.join(homeDir, 'kami-test.zip')
    await fs.promises.writeFile(zipPath, Buffer.from(FRONTMATTER_SKILL_ZIP, 'base64'))

    const manifest = await skillManagementService.importFromZip(zipPath)

    // Title '# kami · 紙' would normalize to 'kami--', but frontmatter 'name: kami' should win
    expect(manifest.name).toBe('kami')
    expect(manifest.description).toBe('Typeset professional documents.')

    const markdown = await skillManagementService.readSkillMarkdown('kami')
    expect(markdown).toContain('# kami · 紙')
  })
})
