import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { VersionedJsonFileStore } from '../versionedJsonFileStore'

describe('versionedJsonFileStore', () => {
  let dir: string
  let filePath: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ant-chat-versioned-json-'))
    filePath = path.join(dir, 'settings.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('按版本顺序升级旧版裸 JSON，并原子写入当前版本', () => {
    writeFileSync(filePath, JSON.stringify({ name: '旧设置' }), 'utf8')
    const store = new VersionedJsonFileStore(filePath, {
      currentVersion: 2,
      migrations: [
        {
          version: 1,
          migrate: value => ({ ...(value as object), enabled: true }),
        },
        {
          version: 2,
          migrate: value => ({ ...(value as object), displayName: (value as { name: string }).name }),
        },
      ],
      parse(value) {
        const data = value as Record<string, unknown>
        if (typeof data.displayName !== 'string' || typeof data.enabled !== 'boolean') {
          throw new TypeError('无效设置')
        }
        return data
      },
    })

    expect(store.read()).toEqual({
      name: '旧设置',
      enabled: true,
      displayName: '旧设置',
    })
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual({
      schemaVersion: 2,
      data: {
        name: '旧设置',
        enabled: true,
        displayName: '旧设置',
      },
    })
  })

  it('迁移失败时保留原文件', () => {
    const original = JSON.stringify({ name: '旧设置' })
    writeFileSync(filePath, original, 'utf8')
    const store = new VersionedJsonFileStore(filePath, {
      currentVersion: 1,
      migrations: [{
        version: 1,
        migrate() {
          throw new Error('迁移失败')
        },
      }],
      parse: value => value,
    })

    expect(() => store.read()).toThrow('文件 schema 迁移到版本 1 失败')
    expect(readFileSync(filePath, 'utf8')).toBe(original)
  })

  it('拒绝读取高于应用支持范围的文件版本', () => {
    writeFileSync(filePath, JSON.stringify({ schemaVersion: 2, data: {} }), 'utf8')
    const store = new VersionedJsonFileStore(filePath, {
      currentVersion: 1,
      migrations: [{ version: 1, migrate: value => value }],
      parse: value => value,
    })

    expect(() => store.read()).toThrow('文件 schema 版本 2 高于当前支持的 1')
  })
})
