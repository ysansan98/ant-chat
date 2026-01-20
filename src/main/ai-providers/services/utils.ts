import type { IMessage } from '@ant-chat/shared'

/**
 * 占位符，用于后续替换为实际的对话内容。
 */
const TITLE_PROMPT_PLACEHOLDER = 'pGqat5J/L@~U'

/**
 * 用于生成会话标题的提示词，要求输出简短且仅包含中文标题。
 */
export const TITLE_PROMPT = `Based on the chat history, give this conversation a name.
Keep it short.
Use 简体中文.
Just provide the name, nothing else.

Here's the conversation:
--------------------------------
${TITLE_PROMPT_PLACEHOLDER}
--------------------------------
Use 简体中文.
Only give the name, nothing else.
The name is:
`

/**
 * 将messages格式化为指定的上下文字符串，并插入到提示词中。
 */
export function formatMessagesForContext(messages: IMessage[]): string {
  const textList = messages.map(
    message => message.content
      .filter(item => item.type === 'text')
      .reduce((acc, item) => {
        return acc + item.text
      }, `Role: ${message.role}\n`),
  )

  return TITLE_PROMPT.replace(
    TITLE_PROMPT_PLACEHOLDER,
    textList.join('\n----------\n'),
  )
}
