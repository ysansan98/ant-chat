/**
 * Transform raw API/technical errors into user-friendly error messages.
 *
 * The original error messages (like "Invalid API Key" or "No output generated")
 * are too technical for end users. This function maps them to clear, actionable
 * messages that help users understand what went wrong and how to fix it.
 */

interface ErrorMapping {
  pattern: RegExp
  message: string
}

const ERROR_MAPPINGS: ErrorMapping[] = [
  // API Key errors
  {
    pattern: /invalid\s+api\s+key/i,
    message: 'API 密钥无效。请检查 Provider 设置中的 API Key 是否正确。',
  },
  {
    pattern: /api\s+key\s+not\s+found/i,
    message: '未找到 API 密钥。请在 Provider 设置中配置 API Key。',
  },
  {
    pattern: /authentication\s+failed/i,
    message: '认证失败。请检查 API Key 是否正确，或确认账户是否有效。',
  },
  {
    pattern: /unauthorized/i,
    message: '认证失败。请检查 API Key 是否正确，或确认账户是否有效。',
  },

  // Rate limit errors
  {
    pattern: /rate\s+limit\s+exceeded/i,
    message: '请求频率过高，请稍后再试。',
  },
  {
    pattern: /too\s+many\s+requests/i,
    message: '请求频率过高，请稍后再试。',
  },
  {
    pattern: /quota\s+exceeded/i,
    message: 'API 配额已用完。请检查账户余额或稍后再试。',
  },

  // Model/Provider errors
  {
    pattern: /model\s+not\s+found/i,
    message: '所选模型不存在。请检查模型配置或选择其他模型。',
  },
  {
    pattern: /model\s+not\s+available/i,
    message: '所选模型暂不可用。请检查模型配置或选择其他模型。',
  },
  {
    pattern: /provider\s+not\s+found/i,
    message: 'Provider 不存在。请检查 Provider 配置。',
  },
  {
    pattern: /no\s+output\s+generated/i,
    message: '模型未返回响应。请检查 API Key 配置，或尝试更换模型。',
  },

  // Network errors
  {
    pattern: /network\s+error/i,
    message: '网络连接失败。请检查网络连接。',
  },
  {
    pattern: /timeout/i,
    message: '请求超时。请检查网络连接或稍后再试。',
  },
  {
    pattern: /econnrefused/i,
    message: '连接被拒绝。请检查 API 地址配置是否正确。',
  },
  {
    pattern: /enotfound/i,
    message: '无法解析服务器地址。请检查网络连接和 API 地址配置。',
  },

  // Context length errors
  {
    pattern: /context\s+length\s+exceeded/i,
    message: '对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。',
  },
  {
    pattern: /maximum\s+context\s+length/i,
    message: '对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。',
  },
  {
    pattern: /token\s+limit\s+exceeded/i,
    message: '对话内容过长，超出模型限制。请尝试缩短输入或开始新对话。',
  },

  // Content policy errors
  {
    pattern: /content\s+policy/i,
    message: '内容不符合使用政策。请修改输入内容。',
  },
  {
    pattern: /safety\s+filter/i,
    message: '内容触发了安全过滤。请修改输入内容。',
  },
]

/**
 * Transform a raw error message into a user-friendly message.
 *
 * @param rawMessage - The original error message from the API/technical error
 * @returns A user-friendly error message
 *
 * @example
 * transformErrorMessage('Invalid API Key provided')
 * // => 'API 密钥无效。请检查 Provider 设置中的 API Key 是否正确。'
 *
 * transformErrorMessage('Some unknown error occurred')
 * // => '请求失败。请检查配置并重试。'
 */
export function transformErrorMessage(rawMessage: string): string {
  for (const mapping of ERROR_MAPPINGS) {
    if (mapping.pattern.test(rawMessage)) {
      return mapping.message
    }
  }

  // Default fallback message
  return '请求失败。请检查配置并重试。'
}
