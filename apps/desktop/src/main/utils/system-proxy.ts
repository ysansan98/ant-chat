import { session } from 'electron'

/**
 * 系统代理检测工具 - 使用Electron内置API
 */

/**
 * 检测系统代理设置
 * 使用Electron的session.resolveProxy方法，这是最可靠的方式
 */
export async function getSystemProxySettings(): Promise<string> {
  try {
    // 测试几个常用的AI服务商域名，获取代理设置
    const testUrls = [
      'https://api.openai.com',
      'https://generativelanguage.googleapis.com',
      'https://api.deepseek.com',
    ]

    // 尝试解析代理，返回第一个有效的代理设置
    for (const url of testUrls) {
      try {
        const proxyString = await session.defaultSession.resolveProxy(url)

        // 如果返回DIRECT说明没有代理
        if (proxyString === 'DIRECT') {
          continue
        }

        // 解析代理字符串，格式可能是："PROXY hostname:port" 或 "SOCKS hostname:port"
        const proxyMatch = proxyString.match(/^(PROXY|SOCKS|SOCKS4|SOCKS5)\s([^:]+):(\d+)/)
        if (proxyMatch) {
          const [, , host, port] = proxyMatch
          // 统一返回http格式，大多数客户端支持
          return `http://${host}:${port}`
        }
      }
      catch (error) {
        // 单个URL解析失败，继续尝试下一个
        console.error('Failed to parse proxy for URL:', url, error)
        continue
      }
    }

    // 如果都没有找到代理，返回空字符串
    return ''
  }
  catch (error) {
    console.error('Failed to detect system proxy using Electron session:', error)
    return ''
  }
}

/**
 * 获取系统代理的详细信息（用于调试）
 */
export async function getSystemProxyInfo(): Promise<{
  mode: string
  proxyUrl: string
  testResults: Record<string, string>
}> {
  const testUrls = [
    'https://api.openai.com',
    'https://generativelanguage.googleapis.com',
    'https://api.deepseek.com',
  ]

  const testResults: Record<string, string> = {}
  let proxyUrl = ''

  for (const url of testUrls) {
    try {
      const proxyString = await session.defaultSession.resolveProxy(url)
      testResults[url] = proxyString

      if (proxyString !== 'DIRECT' && !proxyUrl) {
        const proxyMatch = proxyString.match(/^(PROXY|SOCKS|SOCKS4|SOCKS5)\s([^:]+):(\d+)/)
        if (proxyMatch) {
          const [, , host, port] = proxyMatch
          proxyUrl = `http://${host}:${port}`
        }
      }
    }
    catch (error) {
      testResults[url] = `ERROR: ${error}`
    }
  }

  return {
    mode: proxyUrl ? 'system' : 'none',
    proxyUrl,
    testResults,
  }
}

/**
 * 测试代理连接
 * 通过临时设置环境变量并测试连接来验证代理是否工作
 */
export async function testProxyConnection(proxyUrl: string): Promise<boolean> {
  // 保存原始环境变量
  const originalHttpProxy = process.env.HTTP_PROXY
  const originalHttpsProxy = process.env.HTTPS_PROXY
  const originalNoProxy = process.env.NO_PROXY

  try {
    // 临时设置代理环境变量
    process.env.HTTP_PROXY = proxyUrl
    process.env.HTTPS_PROXY = proxyUrl
    process.env.NO_PROXY = 'localhost,127.0.0.1,::1'

    // 测试连接到一个可靠的地址
    const response = await fetch('https://www.google.com', {
      method: 'HEAD',
      signal: AbortSignal.timeout(10000), // 10秒超时
    })

    return response.ok
  }
  catch (error) {
    console.error('Proxy test failed:', error)
    return false
  }
  finally {
    // 恢复原始环境变量
    if (originalHttpProxy) {
      process.env.HTTP_PROXY = originalHttpProxy
    }
    else {
      delete process.env.HTTP_PROXY
    }

    if (originalHttpsProxy) {
      process.env.HTTPS_PROXY = originalHttpsProxy
    }
    else {
      delete process.env.HTTPS_PROXY
    }

    if (originalNoProxy) {
      process.env.NO_PROXY = originalNoProxy
    }
    else {
      delete process.env.NO_PROXY
    }
  }
}
