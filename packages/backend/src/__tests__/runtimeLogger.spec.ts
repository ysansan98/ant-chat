import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getAppRuntimeLogger } from '../runtimeLogger'

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-runtime-logger-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('getAppRuntimeLogger 行为', () => {
  it('按宿主入口写入不同日志文件', () => {
    const appDataRoot = createTempDir()
    const desktopLogger = getAppRuntimeLogger(appDataRoot, {
      fileName: 'main.log',
      source: 'desktop-main',
    })
    const localServerLogger = getAppRuntimeLogger(appDataRoot, {
      fileName: 'local-server.log',
      source: 'local-server',
    })

    desktopLogger.info('desktop started')
    localServerLogger.info('local server started')

    const logsRoot = path.join(appDataRoot, 'logs')
    expect(readFileSync(path.join(logsRoot, 'main.log'), 'utf8')).toContain('[info] desktop-main desktop started')
    expect(readFileSync(path.join(logsRoot, 'local-server.log'), 'utf8')).toContain('[info] local-server local server started')
  })
})
