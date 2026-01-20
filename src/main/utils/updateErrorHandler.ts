import type { UpdateError, UpdateErrorType, UpdateRecoveryAction } from '@ant-chat/shared'
import { logger } from './logger'

/**
 * 更新错误处理工具类
 *
 * 负责：
 * - 错误类型识别和分类
 * - 生成用户友好的错误信息
 * - 提供恢复建议
 * - 错误重试机制
 */
export class UpdateErrorHandler {
  private static readonly MAX_RETRY_COUNT = 3
  private static readonly RETRY_DELAYS = [1000, 3000, 5000] // 重试延迟（毫秒）

  /**
   * 处理更新错误，返回格式化的错误信息
   */
  static handleError(error: Error | any, context?: string): UpdateError {
    const errorType = this.identifyErrorType(error)
    const userMessage = this.generateUserMessage(errorType, error)
    const recoveryActions = this.generateRecoveryActions(errorType)

    const updateError: UpdateError = {
      type: errorType,
      code: error.code || error.errno || undefined,
      message: error.message || String(error),
      userMessage,
      details: {
        stack: error.stack,
        context,
        originalError: error,
      },
      recoveryActions,
      timestamp: Date.now(),
      retryable: this.isRetryable(errorType),
    }

    // 记录错误日志
    this.logError(updateError, context)

    return updateError
  }

  /**
   * 识别错误类型
   */
  private static identifyErrorType(error: any): UpdateErrorType {
    const message = (error.message || '').toLowerCase()
    const code = error.code || error.errno

    // 网络相关错误
    if (
      message.includes('network')
      || message.includes('timeout')
      || message.includes('connection')
      || message.includes('enotfound')
      || message.includes('econnrefused')
      || message.includes('econnreset')
      || code === 'ENOTFOUND'
      || code === 'ECONNREFUSED'
      || code === 'ETIMEDOUT'
    ) {
      return 'NETWORK_ERROR'
    }

    // 下载相关错误
    if (
      message.includes('download')
      || message.includes('fetch')
      || message.includes('http')
      || message.includes('404')
      || message.includes('403')
      || message.includes('500')
    ) {
      return 'DOWNLOAD_ERROR'
    }

    // 签名验证错误
    if (
      message.includes('signature')
      || message.includes('verify')
      || message.includes('certificate')
      || message.includes('untrusted')
      || message.includes('invalid signature')
    ) {
      return 'SIGNATURE_ERROR'
    }

    // 权限错误
    if (
      message.includes('permission')
      || message.includes('access denied')
      || message.includes('eacces')
      || message.includes('eperm')
      || code === 'EACCES'
      || code === 'EPERM'
    ) {
      return 'PERMISSION_ERROR'
    }

    // 磁盘空间错误
    if (
      message.includes('no space')
      || message.includes('disk full')
      || message.includes('enospc')
      || code === 'ENOSPC'
    ) {
      return 'DISK_SPACE_ERROR'
    }

    // 安装相关错误
    if (
      message.includes('install')
      || message.includes('extract')
      || message.includes('unzip')
    ) {
      return 'INSTALL_ERROR'
    }

    return 'UNKNOWN_ERROR'
  }

  /**
   * 生成用户友好的错误消息
   */
  private static generateUserMessage(errorType: UpdateErrorType, error: any): string {
    switch (errorType) {
      case 'NETWORK_ERROR':
        return '网络连接失败，请检查您的网络连接后重试。'

      case 'DOWNLOAD_ERROR':
        return '下载更新包失败，可能是服务器暂时不可用。'

      case 'SIGNATURE_ERROR':
        return '更新包签名验证失败，为了您的安全，已停止安装。'

      case 'PERMISSION_ERROR':
        return '权限不足，请以管理员身份运行应用程序。'

      case 'DISK_SPACE_ERROR':
        return '磁盘空间不足，请清理磁盘空间后重试。'

      case 'INSTALL_ERROR':
        return '安装更新失败，请尝试手动下载安装。'

      case 'UNKNOWN_ERROR':
      default:
        return `更新过程中发生未知错误：${error.message || '请稍后重试'}`
    }
  }

  /**
   * 生成恢复建议
   */
  private static generateRecoveryActions(errorType: UpdateErrorType): UpdateRecoveryAction[] {
    const actions: UpdateRecoveryAction[] = []

    switch (errorType) {
      case 'NETWORK_ERROR':
        actions.push(
          {
            type: 'retry',
            title: '重试',
            description: '检查网络连接后重新尝试更新',
          },
          {
            type: 'manual_download',
            title: '手动下载',
            description: '从官网手动下载最新版本',
            url: 'https://github.com/your-repo/releases/latest',
          },
        )
        break

      case 'DOWNLOAD_ERROR':
        actions.push(
          {
            type: 'retry',
            title: '重试',
            description: '稍后重新尝试下载',
          },
          {
            type: 'manual_download',
            title: '手动下载',
            description: '从官网手动下载最新版本',
            url: 'https://github.com/your-repo/releases/latest',
          },
        )
        break

      case 'SIGNATURE_ERROR':
        actions.push(
          {
            type: 'manual_download',
            title: '手动下载',
            description: '从官方网站重新下载安装包',
            url: 'https://github.com/your-repo/releases/latest',
          },
          {
            type: 'contact_support',
            title: '联系支持',
            description: '如果问题持续存在，请联系技术支持',
          },
        )
        break

      case 'PERMISSION_ERROR':
        actions.push(
          {
            type: 'check_permission',
            title: '检查权限',
            description: '以管理员身份重新运行应用程序',
          },
          {
            type: 'restart_app',
            title: '重启应用',
            description: '关闭应用后以管理员身份重新启动',
          },
        )
        break

      case 'DISK_SPACE_ERROR':
        actions.push(
          {
            type: 'free_space',
            title: '清理空间',
            description: '清理磁盘空间后重试',
          },
          {
            type: 'manual_download',
            title: '手动下载',
            description: '手动下载到其他位置安装',
            url: 'https://github.com/your-repo/releases/latest',
          },
        )
        break

      case 'INSTALL_ERROR':
        actions.push(
          {
            type: 'retry',
            title: '重试',
            description: '重新尝试安装',
          },
          {
            type: 'restart_app',
            title: '重启应用',
            description: '重启应用后重新尝试',
          },
          {
            type: 'manual_download',
            title: '手动下载',
            description: '手动下载安装包进行安装',
            url: 'https://github.com/your-repo/releases/latest',
          },
        )
        break

      case 'UNKNOWN_ERROR':
      default:
        actions.push(
          {
            type: 'retry',
            title: '重试',
            description: '重新尝试更新',
          },
          {
            type: 'restart_app',
            title: '重启应用',
            description: '重启应用后重新尝试',
          },
          {
            type: 'manual_download',
            title: '手动下载',
            description: '从官网手动下载最新版本',
            url: 'https://github.com/your-repo/releases/latest',
          },
          {
            type: 'contact_support',
            title: '联系支持',
            description: '如果问题持续存在，请联系技术支持',
          },
        )
        break
    }

    return actions
  }

  /**
   * 判断错误是否可重试
   */
  private static isRetryable(errorType: UpdateErrorType): boolean {
    switch (errorType) {
      case 'NETWORK_ERROR':
      case 'DOWNLOAD_ERROR':
      case 'INSTALL_ERROR':
        return true

      case 'SIGNATURE_ERROR':
      case 'PERMISSION_ERROR':
      case 'DISK_SPACE_ERROR':
        return false

      case 'UNKNOWN_ERROR':
      default:
        return true
    }
  }

  /**
   * 记录错误日志
   */
  private static logError(updateError: UpdateError, context?: string): void {
    const logContext = context ? `[${context}] ` : ''

    logger.error(`${logContext}更新错误 [${updateError.type}]:`, {
      type: updateError.type,
      code: updateError.code,
      message: updateError.message,
      userMessage: updateError.userMessage,
      retryable: updateError.retryable,
      timestamp: new Date(updateError.timestamp).toISOString(),
      context,
      details: updateError.details,
    })
  }

  /**
   * 重试机制
   */
  static async withRetry<T>(
    operation: () => Promise<T>,
    maxRetries: number = UpdateErrorHandler.MAX_RETRY_COUNT,
    context?: string,
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = UpdateErrorHandler.RETRY_DELAYS[Math.min(attempt - 1, UpdateErrorHandler.RETRY_DELAYS.length - 1)]
          logger.info(`${context ? `[${context}] ` : ''}重试第 ${attempt} 次，延迟 ${delay}ms`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }

        return await operation()
      }
      catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempt === maxRetries) {
          logger.error(`${context ? `[${context}] ` : ''}重试 ${maxRetries} 次后仍然失败:`, lastError)
          break
        }

        const updateError = UpdateErrorHandler.handleError(lastError, context)
        if (!updateError.retryable) {
          logger.warn(`${context ? `[${context}] ` : ''}错误不可重试，停止重试:`, updateError.type)
          break
        }

        logger.warn(`${context ? `[${context}] ` : ''}第 ${attempt + 1} 次尝试失败:`, lastError.message)
      }
    }

    throw lastError
  }

  /**
   * 创建网络错误
   */
  static createNetworkError(message: string): UpdateError {
    return this.handleError(new Error(message), 'NETWORK_ERROR')
  }

  /**
   * 创建下载错误
   */
  static createDownloadError(message: string): UpdateError {
    return this.handleError(new Error(message), 'DOWNLOAD_ERROR')
  }

  /**
   * 创建签名错误
   */
  static createSignatureError(message: string, code?: string): UpdateError {
    const error = new Error(message)
    if (code) {
      (error as any).code = code
    }
    return this.handleError(error, 'SIGNATURE_ERROR')
  }

  /**
   * 创建安装错误
   */
  static createInstallError(message: string): UpdateError {
    return this.handleError(new Error(message), 'INSTALL_ERROR')
  }
}
