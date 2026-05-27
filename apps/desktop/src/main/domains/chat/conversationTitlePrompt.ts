import type { IMessage } from '@ant-chat/shared'

const TITLE_PROMPT_PLACEHOLDER = 'pGqat5J/L@~U'

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
