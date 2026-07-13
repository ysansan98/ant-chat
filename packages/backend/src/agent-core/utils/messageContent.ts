import type { IMessageContent } from '@ant-chat/shared'

/** 生成 turn 校验、标题和任务快照共用的规范文本，避免各层产生不同结果。 */
export function extractMessageText(content: IMessageContent): string {
  return content
    .filter((block): block is { type: 'text', text: string } => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}
