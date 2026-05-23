/**
 * 这里定义了所有默认模型
 */

const OpenAI = [
  { id: 'gpt-4o', createAt: 1715367049000 },
  { id: 'gpt-4', createAt: 1715367049000 },
  { id: 'o1-mini', createAt: 1725649008000 },
  { id: 'o3-mini', createAt: 1725649008000 },
  { id: 'gpt-3.5-turbo', createAt: 1677610602000 },
]

const DeepSeek = [
  { id: 'deepseek-coder', createAt: 1725649008000 },
  { id: 'deepseek-chat', createAt: 1725649008000 },
  { id: 'deepseek-reasoner', createAt: 1725649008000 },
]

const Google = [
  { id: 'gemini-1.5-pro', createAt: 1741088680842 },
  { id: 'gemini-1.5-flash', createAt: 1741088680842 },
  { id: 'gemini-2.0-flash-exp', createAt: 1741088680842 },
  { id: 'gemini-2.0-flash', createAt: 1741088680842 },
  { id: 'gemini-2.0-flash-lite', createAt: 1741088680842 },
  { id: 'gemini-2.0-pro-exp', createAt: 1741088680842 },
  { id: 'gemini-2.0-flash-thinking-exp', createAt: 1741088680842 },
  { id: 'gemini-2.0-flash-exp-image-generation', createAt: 1741088680842 },
  { id: 'gemini-2.5-pro-exp-03-25', createAt: 1741088680842 },
  { id: 'gemini-2.5-flash-preview-04-17', createAt: 1741088680842 },
]

export default {
  OpenAI,
  DeepSeek,
  Google,
}
