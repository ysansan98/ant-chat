import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSystemLogger } from '../systemLogger'

const tempDirs: string[] = []

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ant-chat-logger-'))
  tempDirs.push(dir)
  return dir
}

function createMockConsole() {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('createSystemLogger 行为', () => {
  it('将格式化消息写入配置的日志文件', () => {
    const dir = createTempDir()
    const filePath = join(dir, 'main.log')
    const mockConsole = createMockConsole()
    const logger = createSystemLogger({ console: mockConsole, filePath, source: 'desktop-main' })

    logger.info('started', { port: 3456 })
    logger.error('failed', new Error('boom'))

    const content = readFileSync(filePath, 'utf8')
    expect(content).toContain('[info] desktop-main started port=3456')
    expect(content).toContain('[error] desktop-main failed Error: boom')
    expect(mockConsole.info).toHaveBeenCalledWith(expect.stringContaining('[info] desktop-main started port=3456'))
    expect(mockConsole.error).toHaveBeenCalledWith(expect.stringContaining('[error] desktop-main failed Error: boom'))
  })

  it('将结构化上下文总结为可读文本', () => {
    const dir = createTempDir()
    const filePath = join(dir, 'main.log')
    const mockConsole = createMockConsole()
    const logger = createSystemLogger({ console: mockConsole, filePath, source: 'desktop-main' })

    logger.info('runtime event', {
      event: 'model_request_started',
      runId: 'task-1',
      messagesPreview: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
    })

    const content = readFileSync(filePath, 'utf8')
    expect(content).toContain('runtime event event=model_request_started runId=task-1 messagesPreview=[1 items]')
    expect(content).not.toContain('{"event"')
    expect(content).not.toContain('"messagesPreview"')
  })

  it('日志文件达到最大大小时轮转', () => {
    const dir = createTempDir()
    const filePath = join(dir, 'ant-chat.log')
    const mockConsole = createMockConsole()
    writeFileSync(filePath, 'x'.repeat(12), 'utf8')

    const logger = createSystemLogger({ console: mockConsole, filePath, maxFileSize: 10 })
    logger.warn('next')

    expect(readFileSync(`${filePath}.1`, 'utf8')).toBe('x'.repeat(12))
    expect(readFileSync(filePath, 'utf8')).toContain('[warn] next')
  })

  it('未启用时不向 console 输出 debug', () => {
    const dir = createTempDir()
    const filePath = join(dir, 'debug.log')
    const mockConsole = createMockConsole()

    const logger = createSystemLogger({ console: mockConsole, filePath })
    logger.debug('hidden')

    expect(readFileSync(filePath, 'utf8')).toContain('[debug] hidden')
    expect(mockConsole.debug).not.toHaveBeenCalled()
  })
})
