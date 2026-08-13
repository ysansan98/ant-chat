import type { IMessageContent } from '@ant-chat/shared'

/** 生成 turn 校验、标题和任务快照共用的规范文本，避免各层产生不同结果。 */
export function extractMessageText(content: IMessageContent): string {
  return content
    .filter((block): block is { type: 'text', text: string } | { type: 'annotation', quote: string, comment: string, targetMessageId: string } =>
      block.type === 'text' || block.type === 'annotation')
    .map((block) => {
      // 批注块：评论为空（只引用不评论）时用引用原文兜底，保证纯批注消息有可校验文本
      if (block.type === 'annotation') {
        return block.comment || block.quote
      }
      return block.text
    })
    .join('\n')
    .trim()
}
