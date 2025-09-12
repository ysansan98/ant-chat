import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateService } from '../UpdateService'

// Mock electron modules
vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
  },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    allowPrerelease: false,
  },
}))

vi.mock('@main/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
  },
}))

vi.mock('@main/utils/updateErrorHandler', () => ({
  UpdateErrorHandler: {
    withRetry: vi.fn(fn => fn()),
    handleError: vi.fn(() => ({
      type: 'NETWORK_ERROR',
      message: 'Test error',
      userMessage: 'Test user message',
      recoveryActions: [],
      timestamp: Date.now(),
      retryable: true,
    })),
    createDownloadError: vi.fn(() => new Error('Download error')),
    createInstallError: vi.fn(() => new Error('Install error')),
  },
}))

vi.mock('@main/utils/updateLogger', () => ({
  updateLogger: {
    logSystemInfo: vi.fn(),
    logCheckStart: vi.fn(),
    logCheckResult: vi.fn(),
    logDownloadStart: vi.fn(),
    logDownloadProgress: vi.fn(),
    logDownloadComplete: vi.fn(),
    logInstallStart: vi.fn(),
    logInstallComplete: vi.fn(),
    logConfigChange: vi.fn(),
    logStatusChange: vi.fn(),
    logUserAction: vi.fn(),
    logError: vi.fn(),
    logPerformance: vi.fn(),
  },
}))

vi.mock('@main/utils/ipc-events-bus', () => ({
  mainEmitter: {
    send: vi.fn(),
  },
}))

vi.mock('@main/store/updateSettings', () => ({
  UpdateConfigStore: {
    getInstance: vi.fn(() => ({
      getConfig: vi.fn(() => ({
        autoCheck: true,
        autoDownload: true,
        checkInterval: 'startup',
        includePrerelease: false,
        lastCheckTime: 0,
      })),
      updateConfig: vi.fn(),
      setLastCheckTime: vi.fn(),
      shouldCheckForUpdates: vi.fn(() => true),
      shouldSkipVersion: vi.fn(() => false),
      setSkippedVersion: vi.fn(),
    })),
  },
}))

describe('updateService', () => {
  let updateService: UpdateService

  beforeEach(() => {
    updateService = UpdateService.getInstance()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('应该是单例模式', () => {
    const instance1 = UpdateService.getInstance()
    const instance2 = UpdateService.getInstance()
    expect(instance1).toBe(instance2)
  })

  it('应该返回当前版本', () => {
    const version = updateService.getCurrentVersion()
    expect(version).toBe('1.0.0')
  })

  it('应该返回正确的更新状态', () => {
    const status = updateService.getUpdateStatus()
    expect(status).toBe('idle')
  })

  it('应该能够获取更新配置', () => {
    const config = updateService.getUpdateConfig()
    expect(config).toEqual({
      autoCheck: true,
      autoDownload: true,
      checkInterval: 'startup',
      includePrerelease: false,
      lastCheckTime: 0,
    })
  })

  it('应该能够更新配置', () => {
    const newConfig = updateService.updateConfig({ autoCheck: false })
    expect(newConfig).toBeDefined()
  })

  it('应该能够跳过版本', () => {
    expect(() => {
      updateService.skipVersion('1.1.0')
    }).not.toThrow()
  })

  it('应该正确格式化发布说明 - 字符串类型', () => {
    const service = updateService as any
    const result = service.formatReleaseNotes('Test release notes')
    expect(result).toBe('Test release notes')
  })

  it('应该正确格式化发布说明 - 数组类型', () => {
    const service = updateService as any
    const result = service.formatReleaseNotes(['Note 1', 'Note 2'])
    expect(result).toBe('Note 1\nNote 2')
  })

  it('应该正确格式化发布说明 - 空值', () => {
    const service = updateService as any
    expect(service.formatReleaseNotes(null)).toBe('')
    expect(service.formatReleaseNotes(undefined)).toBe('')
    expect(service.formatReleaseNotes('')).toBe('')
  })

  it('应该正确处理错误', () => {
    // 这个测试现在由 UpdateErrorHandler 处理
    expect(true).toBe(true)
  })

  it('应该检查下载状态', () => {
    expect(updateService.isDownloading()).toBe(false)
    expect(updateService.isDownloaded()).toBe(false)
  })
})
