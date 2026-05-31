import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const originalCwd = process.cwd()
const originalNodeEnv = process.env.NODE_ENV

afterEach(() => {
  process.chdir(originalCwd)
  process.env.NODE_ENV = originalNodeEnv
  vi.resetModules()
})

describe('resolveAppDataRoot', () => {
  it('uses workspace root .ant-chat in non-production', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-workspace-'))
    const subdir = path.join(workspaceRoot, 'packages', 'local-server')
    fs.mkdirSync(subdir, { recursive: true })
    fs.writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    process.chdir(subdir)
    process.env.NODE_ENV = 'development'

    const { resolveAppDataRoot } = await import('../appPaths')

    expect(resolveAppDataRoot()).toBe(path.join(fs.realpathSync(workspaceRoot), '.ant-chat'))
  })

  it('uses ~/.ant-chat in production', async () => {
    process.env.NODE_ENV = 'production'

    const { resolveAppDataRoot } = await import('../appPaths')

    expect(resolveAppDataRoot()).toBe(path.join(os.homedir(), '.ant-chat'))
  })
})
