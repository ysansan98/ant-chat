/** 发送前编辑态的批注草稿（临时状态，不落库）。 */
export interface AnnotationDraft {
  id: string
  /** 归属的文本 step（turnSteps 生成的 text step id） */
  stepId: string
  /** 引用原文所在的 assistant 消息 id（发送进 annotation block，编辑定位用） */
  targetMessageId: string
  /** 选中内容快照：取自渲染文本映射，与渲染结果始终一致 */
  quote: string
  comment: string
  /** 渲染文本映射中的起始/结束偏移（创建时由选区确定） */
  start: number
  end: number
}

/** 从 text step id（`<messageId>:text:<index>`）反解来源消息 id。 */
export function extractTargetMessageId(stepId: string): string {
  return stepId.split(':text:')[0] ?? stepId
}
