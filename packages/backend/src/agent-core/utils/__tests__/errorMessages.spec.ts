import { describe, expect, it } from 'vitest'
import { transformErrorMessage } from '../errorMessages'

describe('transformErrorMessage 行为', () => {
  describe('api key 错误', () => {
    it('转换 Invalid API Key 错误', () => {
      const result = transformErrorMessage('Invalid API Key')
      expect(result).toBe('API 密钥无效。请检查 Provider 设置中的 API Key 是否正确。')
    })

    it('转换 API key not found 错误', () => {
      const result = transformErrorMessage('API key not found')
      expect(result).toBe('未找到 API 密钥。请在 Provider 设置中配置 API Key。')
    })

    it('转换 authentication failed 错误', () => {
      const result = transformErrorMessage('authentication failed')
      expect(result).toBe('认证失败。请检查 API Key 是否正确，或确认账户是否有效。')
    })

    it('转换 unauthorized 错误', () => {
      const result = transformErrorMessage('unauthorized access')
      expect(result).toBe('认证失败。请检查 API Key 是否正确，或确认账户是否有效。')
    })
  })

  describe('限流错误', () => {
    it('转换 rate limit exceeded 错误', () => {
      const result = transformErrorMessage('rate limit exceeded')
      expect(result).toBe('请求频率过高，请稍后再试。')
    })

    it('转换 too many requests 错误', () => {
      const result = transformErrorMessage('too many requests')
      expect(result).toBe('请求频率过高，请稍后再试。')
    })

    it('转换 quota exceeded 错误', () => {
      const result = transformErrorMessage('quota exceeded')
      expect(result).toBe('API 配额已用完。请检查账户余额或稍后再试。')
    })
  })

  describe('模型和 provider 错误', () => {
    it('转换 model not found 错误', () => {
      const result = transformErrorMessage('model not found')
      expect(result).toBe('所选模型不存在。请检查模型配置或选择其他模型。')
    })

    it('转换 model not available 错误', () => {
      const result = transformErrorMessage('model not available')
      expect(result).toBe('所选模型暂不可用。请检查模型配置或选择其他模型。')
    })

    it('转换 provider not found 错误', () => {
      const result = transformErrorMessage('provider not found')
      expect(result).toBe('Provider 不存在。请检查 Provider 配置。')
    })

    it('转换 no output generated 错误', () => {
      const result = transformErrorMessage('No output generated. Check the stream for errors.')
      expect(result).toBe('模型未返回响应。请检查 API Key 配置，或尝试更换模型。')
    })
  })

  describe('网络错误', () => {
    it('转换 network 错误', () => {
      const result = transformErrorMessage('network error')
      expect(result).toBe('网络连接失败。请检查网络连接。')
    })

    it('转换 timeout 错误', () => {
      const result = transformErrorMessage('timeout')
      expect(result).toBe('请求超时。请检查网络连接或稍后再试。')
    })

    it('转换 connection refused 错误', () => {
      const result = transformErrorMessage('ECONNREFUSED')
      expect(result).toBe('连接被拒绝。请检查 API 地址配置是否正确。')
    })

    it('转换 host not found 错误', () => {
      const result = transformErrorMessage('ENOTFOUND')
      expect(result).toBe('无法解析服务器地址。请检查网络连接和 API 地址配置。')
    })
  })

  describe('上下文长度错误', () => {
    it('转换 context length exceeded 错误', () => {
      const result = transformErrorMessage('context length exceeded')
      expect(result).toBe('对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。')
    })

    it('转换 maximum context length 错误', () => {
      const result = transformErrorMessage('maximum context length exceeded')
      expect(result).toBe('对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。')
    })

    it('转换 token limit exceeded 错误', () => {
      const result = transformErrorMessage('token limit exceeded')
      expect(result).toBe('对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。')
    })
  })

  describe('内容策略错误', () => {
    it('转换 content policy 错误', () => {
      const result = transformErrorMessage('content policy violation')
      expect(result).toBe('内容不符合使用政策。请修改输入内容。')
    })

    it('转换 safety filter 错误', () => {
      const result = transformErrorMessage('safety filter triggered')
      expect(result).toBe('内容触发了安全过滤。请修改输入内容。')
    })
  })

  describe('agent 错误', () => {
    it('转换 approval timeout 错误', () => {
      const result = transformErrorMessage('Approval timeout')
      expect(result).toBe('审批超时，请重新操作。')
    })
  })

  describe('未知错误', () => {
    it('未知错误返回原始消息', () => {
      const rawMessage = 'some unknown error occurred'
      const result = transformErrorMessage(rawMessage)
      expect(result).toBe(rawMessage)
    })

    it('空字符串返回原始消息', () => {
      const result = transformErrorMessage('')
      expect(result).toBe('')
    })

    it('没有 pattern 匹配时返回原始 provider response body', () => {
      const rawMessage = `responseBody: '{\n' +
    '    "error": {\n' +
    '        "code": "999",\n' +
    '        "message": "Unknown server error",\n' +
    '        "type": "internal_error"\n' +
    '    }\n' +
    '}\n'`
      const result = transformErrorMessage(rawMessage)
      expect(result).toBe(rawMessage)
    })
  })

  describe('大小写不敏感', () => {
    it('处理大写 API key 错误', () => {
      const result = transformErrorMessage('INVALID API KEY')
      expect(result).toBe('API 密钥无效。请检查 Provider 设置中的 API Key 是否正确。')
    })

    it('处理大小写混合的模型错误', () => {
      const result = transformErrorMessage('Model Not Found')
      expect(result).toBe('所选模型不存在。请检查模型配置或选择其他模型。')
    })
  })
})
