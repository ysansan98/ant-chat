import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

const originalCwd = process.cwd()

afterEach(() => {
  process.chdir(originalCwd)
  vi.doUnmock('@main/utils/env')
  vi.resetModules()
})

describe('appPaths', () => {
  it('uses the workspace root .ant-chat directory in development', async () => {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ant-chat-workspace-root-'))
    const desktopRoot = path.join(workspaceRoot, 'apps', 'desktop')
    fs.mkdirSync(desktopRoot, { recursive: true })
    fs.writeFileSync(path.join(workspaceRoot, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n')
    process.chdir(desktopRoot)

    vi.doMock('@main/utils/env', () => ({
      isDev: true,
    }))

    const { getAppDataRoot } = await import('../appPaths')

    expect(getAppDataRoot()).toBe(path.join(fs.realpathSync(workspaceRoot), '.ant-chat'))
  })
})
