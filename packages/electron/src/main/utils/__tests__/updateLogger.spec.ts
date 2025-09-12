import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProgressInfo, UpdateConfig, UpdateError, UpdateInfo } from '@ant-chat/shared'

// Mock electron-log
vi.mock('electron-log', () => ({
  default: {
    create: vi.fn(() => ({
      transports: {
        file: {
          maxSize: 0,
          resolvePathFn: vi.fn(),
        },
        console: {
          level: 'info',
        },
      },
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
  },
}))

// Mock utils
vi.mock('../constants', () => ({
  APP_NAME: 'test-app',
}))

vi.mock('../util', () => ({
  getAppHand: vi.fn(() => '/test/path'),
}))

describe('updateLogger', () => {
  let UpdateLogger: any
  let updateLogger: any

  beforeEach(async () => {
    vi.clearAllMocks()
    // 动态导入以确保 mock 生效
    const module = await import('../updateLogger')
    UpdateLogger = module.UpdateLogger
    updateLogger = module.updateLogger
  })

  it('应该是单例模式', () => {
    const instance1 = UpdateLogger.getInstance()
    const instance2 = UpdateLogger.getInstance()
    expect(instance1).toBe(instance2)
  })

  it('应该记录检查更新开始', () => {
    updateLogger.logCheckStart(true)
    expect(updateLogger.logger.info).toHaveBeenCalledWith('开始检查更新', {
      type: 'manual',
      timestamp: expect.any(String),
    })
  })

  it('应该记录检查更新结果 - 有更新', () => {
    const updateInfo: UpdateInfo = {
      version: '1.1.0',
      releaseDate: '2023-01-01',
      releaseNotes: 'Test notes',
      downloadSize: 1024,
      downloadUrl: 'https://example.com/update.zip',
    }

    updateLogger.logCheckResult(true, updateInfo)
    expect(updateLogger.logger.info).toHaveBeenCalledWith('发现可用更新', {
      version: '1.1.0',
      releaseDate: '2023-01-01',
      downloadSize: 1024,
      timestamp: expect.any(String),
    })
  })

  it('应该记录检查更新结果 - 无更新', () => {
    updateLogger.logCheckResult(false)
    expect(updateLogger.logger.info).toHaveBeenCalledWith('当前已是最新版本', {
      timestamp: expect.any(String),
    })
  })

  it('应该记录下载开始', () => {
    const updateInfo: UpdateInfo = {
      version: '1.1.0',
      releaseDate: '2023-01-01',
      releaseNotes: 'Test notes',
      downloadSize: 1024,
      downloadUrl: 'https://example.com/update.zip',
    }

    updateLogger.logDownloadStart(updateInfo)
    expect(updateLogger.logger.info).toHaveBeenCalledWith('开始下载更新', {
      version: '1.1.0',
      downloadSize: 1024,
      downloadUrl: 'https://example.com/update.zip',
      timestamp: expect.any(String),
    })
  })

  it('应该记录下载进度 - 关键进度点', () => {
    const progress: ProgressInfo = {
      percent: 50,
      bytesPerSecond: 1024,
      total: 2048,
      transferred: 1024,
    }

    updateLogger.logDownloadProgress(progress)
    expect(updateLogger.logger.info).toHaveBeenCalledWith('下载进度更新', {
      percent: 50,
      bytesPerSecond: 1024,
      total: 2048,
      transferred: 1024,
      timestamp: expect.any(String),
    })
  })

  it('应该跳过非关键下载进度', () => {
    const progress: ProgressInfo = {
      percent: 33, // 不是 25 的倍数
      bytesPerSecond: 1024,
      total: 2048,
      transferred: 675,
    }

    updateLogger.logDownloadProgress(progress)
    expect(updateLogger.logger.info).not.toHaveBeenCalled()
  })

  it('应该记录配置更改', () => {
    const oldConfig: UpdateConfig = {
      autoCheck: true,
      autoDownload: false,
      checkInterval: 'startup',
      includePrerelease: false,
      lastCheckTime: 0,
    }

    const newConfig: UpdateConfig = {
      autoCheck: true,
      autoDownload: true,
      checkInterval: 'daily',
      includePrerelease: false,
      lastCheckTime: 0,
    }

    updateLogger.logConfigChange(oldConfig, newConfig)
    expect(updateLogger.logger.info).toHaveBeenCalledWith('更新配置已更改', {
      changes: {
        autoDownload: { old: false, new: true },
        checkInterval: { old: 'startup', new: 'daily' },
      },
      timestamp: expect.any(String),
    })
  })

  it('应该记录用户操作', () => {
    updateLogger.logUserAction('手动检查更新', { version: '1.0.0' })
    expect(updateLogger.logger.info).toHaveBeenCalledWith('用户操作', {
      action: '手动检查更新',
      details: { version: '1.0.0' },
      timestamp: expect.any(String),
    })
  })

  it('应该记录错误', () => {
    const error: UpdateError = {
      type: 'NETWORK_ERROR',
      message: 'Connection failed',
      userMessage: '网络连接失败',
      recoveryActions: [],
      timestamp: Date.now(),
      retryable: true,
    }

    updateLogger.logError(error, 'test context')
    expect(updateLogger.logger.error).toHaveBeenCalledWith('更新错误', {
      type: 'NETWORK_ERROR',
      code: undefined,
      message: 'Connection failed',
      userMessage: '网络连接失败',
      retryable: true,
      context: 'test context',
      timestamp: expect.any(String),
      details: undefined,
    })
  })

  it('应该获取日志文件路径', () => {
    const path = updateLogger.getLogPath()
    expect(path).toContain('test-app')
    expect(path).toContain('logs/update.log')
  })
})
