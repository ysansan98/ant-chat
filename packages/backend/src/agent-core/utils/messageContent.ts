import type { IMessageContent } from '@ant-chat/shared'

/** turn 入口（startTurn / prepareTask）的文本校验：提取可发送文本（text + 批注块），空消息拒绝。 */
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
