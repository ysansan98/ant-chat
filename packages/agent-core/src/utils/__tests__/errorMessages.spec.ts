import { describe, expect, it } from 'vitest'
import { transformErrorMessage } from '../errorMessages'

describe('transformErrorMessage', () => {
  describe('api key errors', () => {
    it('transforms Invalid API Key error', () => {
      const result = transformErrorMessage('Invalid API Key')
      expect(result).toBe('API 密钥无效。请检查 Provider 设置中的 API Key 是否正确。')
    })

    it('transforms API key not found error', () => {
      const result = transformErrorMessage('API key not found')
      expect(result).toBe('未找到 API 密钥。请在 Provider 设置中配置 API Key。')
    })

    it('transforms authentication failed error', () => {
      const result = transformErrorMessage('authentication failed')
      expect(result).toBe('认证失败。请检查 API Key 是否正确，或确认账户是否有效。')
    })

    it('transforms unauthorized error', () => {
      const result = transformErrorMessage('unauthorized access')
      expect(result).toBe('认证失败。请检查 API Key 是否正确，或确认账户是否有效。')
    })
  })

  describe('rate limit errors', () => {
    it('transforms rate limit exceeded error', () => {
      const result = transformErrorMessage('rate limit exceeded')
      expect(result).toBe('请求频率过高，请稍后再试。')
    })

    it('transforms too many requests error', () => {
      const result = transformErrorMessage('too many requests')
      expect(result).toBe('请求频率过高，请稍后再试。')
    })

    it('transforms quota exceeded error', () => {
      const result = transformErrorMessage('quota exceeded')
      expect(result).toBe('API 配额已用完。请检查账户余额或稍后再试。')
    })
  })

  describe('model/provider errors', () => {
    it('transforms model not found error', () => {
      const result = transformErrorMessage('model not found')
      expect(result).toBe('所选模型不存在。请检查模型配置或选择其他模型。')
    })

    it('transforms model not available error', () => {
      const result = transformErrorMessage('model not available')
      expect(result).toBe('所选模型暂不可用。请检查模型配置或选择其他模型。')
    })

    it('transforms provider not found error', () => {
      const result = transformErrorMessage('provider not found')
      expect(result).toBe('Provider 不存在。请检查 Provider 配置。')
    })

    it('transforms no output generated error', () => {
      const result = transformErrorMessage('No output generated. Check the stream for errors.')
      expect(result).toBe('模型未返回响应。请检查 API Key 配置，或尝试更换模型。')
    })
  })

  describe('network errors', () => {
    it('transforms network error', () => {
      const result = transformErrorMessage('network error')
      expect(result).toBe('网络连接失败。请检查网络连接。')
    })

    it('transforms timeout error', () => {
      const result = transformErrorMessage('timeout')
      expect(result).toBe('请求超时。请检查网络连接或稍后再试。')
    })

    it('transforms connection refused error', () => {
      const result = transformErrorMessage('ECONNREFUSED')
      expect(result).toBe('连接被拒绝。请检查 API 地址配置是否正确。')
    })

    it('transforms host not found error', () => {
      const result = transformErrorMessage('ENOTFOUND')
      expect(result).toBe('无法解析服务器地址。请检查网络连接和 API 地址配置。')
    })
  })

  describe('context length errors', () => {
    it('transforms context length exceeded error', () => {
      const result = transformErrorMessage('context length exceeded')
      expect(result).toBe('对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。')
    })

    it('transforms maximum context length error', () => {
      const result = transformErrorMessage('maximum context length exceeded')
      expect(result).toBe('对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。')
    })

    it('transforms token limit exceeded error', () => {
      const result = transformErrorMessage('token limit exceeded')
      expect(result).toBe('对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。')
    })
  })

  describe('content policy errors', () => {
    it('transforms content policy error', () => {
      const result = transformErrorMessage('content policy violation')
      expect(result).toBe('内容不符合使用政策。请修改输入内容。')
    })

    it('transforms safety filter error', () => {
      const result = transformErrorMessage('safety filter triggered')
      expect(result).toBe('内容触发了安全过滤。请修改输入内容。')
    })
  })

  describe('unknown errors', () => {
    it('returns default message for unknown errors', () => {
      const result = transformErrorMessage('some unknown error occurred')
      expect(result).toBe('请求失败。请检查配置并重试。')
    })

    it('returns default message for empty string', () => {
      const result = transformErrorMessage('')
      expect(result).toBe('请求失败。请检查配置并重试。')
    })
  })

  describe('case insensitivity', () => {
    it('handles uppercase API key error', () => {
      const result = transformErrorMessage('INVALID API KEY')
      expect(result).toBe('API 密钥无效。请检查 Provider 设置中的 API Key 是否正确。')
    })

    it('handles mixed case model error', () => {
      const result = transformErrorMessage('Model Not Found')
      expect(result).toBe('所选模型不存在。请检查模型配置或选择其他模型。')
    })
  })
})
