import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BrowserSessionManager } from '../browserSessionManager'

describe('browserSessionManager', () => {
  let root: string
  let originalPath: string | undefined

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-browser-session-'))
    const executablePath = path.join(root, 'agent-browser')
    fs.writeFileSync(executablePath, '#!/usr/bin/env node\nprocess.exit(0)\n')
    fs.chmodSync(executablePath, 0o755)
    originalPath = process.env.PATH
    process.env.PATH = [root, path.dirname(process.execPath)].join(path.delimiter)
  })

  afterEach(() => {
    process.env.PATH = originalPath
    fs.rmSync(root, { recursive: true, force: true })
  })

  it('reuses one session within a conversation and isolates different conversations', () => {
    const manager = createManager()

    const firstTurn = manager.get('conv-1')
    const secondTurn = manager.get('conv-1')
    const otherConversation = manager.get('conv-2')

    expect(secondTurn).toBe(firstTurn)
    expect(otherConversation.sessionName).not.toBe(firstTurn.sessionName)
    expect(otherConversation.socketPath).not.toBe(firstTurn.socketPath)
    expect(otherConversation.profilePath).not.toBe(firstTurn.profilePath)
  })

  it('derives stable session paths after the application restarts', () => {
    const first = createManager().get('conv-1')
    const restored = createManager().get('conv-1')

    expect(restored.sessionName).toBe(first.sessionName)
    expect(restored.socketPath).toBe(first.socketPath)
    expect(restored.profilePath).toBe(first.profilePath)
  })

  it('releases the session when a conversation closes', async () => {
    const manager = createManager()
    const first = manager.get('conv-1')
    fs.mkdirSync(first.socketPath, { recursive: true })
    fs.mkdirSync(first.profilePath, { recursive: true })
    fs.writeFileSync(path.join(first.profilePath, 'Preferences'), '{}')

    await manager.close('conv-1', true)
    const next = manager.get('conv-1')

    expect(next).not.toBe(first)
    expect(next).toMatchObject({ started: false, headed: false })
    expect(fs.existsSync(first.socketPath)).toBe(false)
    expect(fs.existsSync(first.profilePath)).toBe(false)
    expect(next.profilePath).toBe(first.profilePath)
  })

  function createManager() {
    return new BrowserSessionManager({
      profilePath: path.join(root, 'profile'),
      artifactsPath: path.join(root, 'artifacts'),
    })
  }
})
