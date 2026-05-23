import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdateErrorHandler } from '../updateErrorHandler'

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

// Mock updateLogger
vi.mock('../updateLogger', () => ({
  updateLogger: {
    logError: vi.fn(),
    logRetry: vi.fn(),
  },
}))

describe('updateErrorHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('handleError', () => {
    it('应该正确识别网络错误', () => {
      const error = new Error('network timeout')
      const result = UpdateErrorHandler.handleError(error)

      expect(result.type).toBe('NETWORK_ERROR')
      expect(result.message).toBe('network timeout')
      expect(result.userMessage).toBe('网络连接失败，请检查您的网络连接后重试。')
      expect(result.retryable).toBe(true)
      expect(result.recoveryActions).toHaveLength(2)
    })

    it('应该正确识别下载错误', () => {
      const error = new Error('download failed')
      const result = UpdateErrorHandler.handleError(error)

      expect(result.type).toBe('DOWNLOAD_ERROR')
      expect(result.retryable).toBe(true)
    })

    it('应该正确识别签名错误', () => {
      const error = new Error('signature verification failed')
      const result = UpdateErrorHandler.handleError(error)

      expect(result.type).toBe('SIGNATURE_ERROR')
      expect(result.retryable).toBe(false)
    })

    it('应该正确识别权限错误', () => {
      const error = new Error('permission denied')
      const result = UpdateErrorHandler.handleError(error)

      expect(result.type).toBe('PERMISSION_ERROR')
      expect(result.retryable).toBe(false)
    })

    it('应该正确识别磁盘空间错误', () => {
      const error = new Error('no space left on device')
      const result = UpdateErrorHandler.handleError(error)

      expect(result.type).toBe('DISK_SPACE_ERROR')
      expect(result.retryable).toBe(false)
    })

    it('应该正确识别安装错误', () => {
      const error = new Error('install failed')
      const result = UpdateErrorHandler.handleError(error)

      expect(result.type).toBe('INSTALL_ERROR')
      expect(result.retryable).toBe(true)
    })

    it('应该处理未知错误', () => {
      const error = new Error('some unknown error')
      const result = UpdateErrorHandler.handleError(error)

      expect(result.type).toBe('UNKNOWN_ERROR')
      expect(result.retryable).toBe(true)
    })
  })

  describe('withRetry', () => {
    it('应该在成功时不重试', async () => {
      const operation = vi.fn().mockResolvedValue('success')

      const result = await UpdateErrorHandler.withRetry(operation, 3)

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(1)
    })

    it('应该在失败时重试', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue('success')

      const result = await UpdateErrorHandler.withRetry(operation, 3)

      expect(result).toBe('success')
      expect(operation).toHaveBeenCalledTimes(3)
    })

    it('应该在达到最大重试次数后抛出错误', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('persistent error'))

      await expect(UpdateErrorHandler.withRetry(operation, 2)).rejects.toThrow('persistent error')
      expect(operation).toHaveBeenCalledTimes(3) // 初始尝试 + 2次重试
    })

    it('应该对不可重试的错误停止重试', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('signature verification failed'))

      await expect(UpdateErrorHandler.withRetry(operation, 3)).rejects.toThrow('signature verification failed')
      expect(operation).toHaveBeenCalledTimes(1) // 只尝试一次
    })
  })

  describe('创建特定错误类型', () => {
    it('应该创建网络错误', () => {
      const error = UpdateErrorHandler.createNetworkError('Connection failed')
      expect(error.type).toBe('NETWORK_ERROR')
    })

    it('应该创建下载错误', () => {
      const error = UpdateErrorHandler.createDownloadError('Download failed')
      expect(error.type).toBe('DOWNLOAD_ERROR')
    })

    it('应该创建签名错误', () => {
      const error = UpdateErrorHandler.createSignatureError('Signature invalid')
      expect(error.type).toBe('SIGNATURE_ERROR')
    })

    it('应该创建安装错误', () => {
      const error = UpdateErrorHandler.createInstallError('Install failed')
      expect(error.type).toBe('INSTALL_ERROR')
    })
  })
})
