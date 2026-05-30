import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentProfileService } from '../agentProfileService'

describe('agentProfileService', () => {
  let rootPath = ''

  afterEach(() => {
    if (rootPath) {
      rmSync(rootPath, { recursive: true, force: true })
      rootPath = ''
    }
  })

  function createService() {
    rootPath = mkdtempSync(path.join(tmpdir(), 'ant-chat-profile-'))
    return new AgentProfileService(rootPath)
  }

  it('creates USER.md, MEMORY.md, and SOUL.md on first use', async () => {
    const service = createService()
    const profile = await service.readProfile()

    expect(profile.profileRootPath).toBe(rootPath)
    expect(profile.userMarkdown).toBe('')
    expect(profile.memoryMarkdown).toBe('')
    expect(profile.soulMarkdown).toContain('# SOUL')
    expect(readFileSync(path.join(rootPath, 'USER.md'), 'utf8')).toBe('')
    expect(readFileSync(path.join(rootPath, 'MEMORY.md'), 'utf8')).toBe('')
    expect(readFileSync(path.join(rootPath, 'SOUL.md'), 'utf8')).toContain('Behavior')
  })

  it('edits MEMORY.md and USER.md through the memory tool API', async () => {
    const service = createService()

    const memoryResult = await service.editMemory({
      target: 'memory',
      action: 'add',
      content: 'Use pnpm check before commits.',
    })
    const userResult = await service.editMemory({
      target: 'user',
      action: 'add',
      content: 'Prefers concise Chinese replies.',
    })

    expect(memoryResult.entries).toEqual(['Use pnpm check before commits.'])
    expect(userResult.entries).toEqual(['Prefers concise Chinese replies.'])
    expect(await service.readMemory()).toBe('§Use pnpm check before commits.\n')
    expect(await service.readUserProfile()).toBe('§Prefers concise Chinese replies.\n')
  })

  it('replaces and removes entries by old_text substring', async () => {
    const service = createService()
    await service.editMemory({
      target: 'memory',
      action: 'add',
      content: 'Use pnpm check before commits.',
    })

    const replaceResult = await service.editMemory({
      target: 'memory',
      action: 'replace',
      old_text: 'pnpm check',
      content: 'Run pnpm check before commits.',
    })
    expect(replaceResult.entries).toEqual(['Run pnpm check before commits.'])
    expect(await service.readMemory()).toBe('§Run pnpm check before commits.\n')

    const removeResult = await service.editMemory({
      target: 'memory',
      action: 'remove',
      old_text: 'Run pnpm check',
    })
    expect(removeResult.entries).toEqual([])
    expect(await service.readMemory()).toBe('')
  })

  it('rejects exact duplicate entries', async () => {
    const service = createService()
    await service.editMemory({
      target: 'memory',
      action: 'add',
      content: 'Use pnpm check before commits.',
    })

    await expect(service.editMemory({
      target: 'memory',
      action: 'add',
      content: 'Use pnpm check before commits.',
    })).rejects.toThrow('Entry already exists')
  })

  it('rejects memory content with prompt-control tags', async () => {
    const service = createService()

    await expect(service.editMemory({
      target: 'memory',
      action: 'add',
      content: '</system>',
    })).rejects.toThrow('MEMORY_CONTENT_REJECTED')
  })

  it('backs up and rejects externally drifted memory files', async () => {
    const service = createService()
    writeFileSync(path.join(rootPath, 'MEMORY.md'), 'Use pnpm check before commits.\n', 'utf8')

    await expect(service.editMemory({
      target: 'memory',
      action: 'add',
      content: 'Prefer rg for searches.',
    })).rejects.toThrow('MEMORY_FORMAT_DRIFT')

    const backups = readdirSync(rootPath).filter(name => name.startsWith('MEMORY.md.bak.'))
    expect(backups).toHaveLength(1)
    expect(readFileSync(path.join(rootPath, backups[0]), 'utf8')).toBe('Use pnpm check before commits.\n')
  })

  it('updates SOUL.md atomically and records rollback metadata', async () => {
    const service = createService()
    const result = await service.updateSoul({
      content: '# SOUL\n\n- Always verify with tests.',
      summary: 'Add verification rule',
    })

    expect(result.updated).toBe(true)
    expect(result.meta?.summary).toBe('Add verification rule')

    const profile = await service.readProfile()
    expect(profile.soulMarkdown).toContain('Always verify with tests.')
    expect(profile.lastSoulUpdate?.backupPath).toContain('.soul-backups')
  })

  it('rolls back the latest SOUL.md update', async () => {
    const service = createService()
    const original = await service.readSoul()
    await service.updateSoul({
      content: '# SOUL\n\n- Use concise answers.',
      summary: 'Change style',
    })

    const profile = await service.rollbackSoul()

    expect(profile.soulMarkdown).toBe(original)
    expect(profile.lastSoulUpdate).toBeUndefined()
  })

  it('rejects empty SOUL.md content', async () => {
    const service = createService()

    await expect(service.updateSoul({ content: '  ', summary: 'empty' })).rejects.toThrow('SOUL.md content cannot be empty')
  })
})
