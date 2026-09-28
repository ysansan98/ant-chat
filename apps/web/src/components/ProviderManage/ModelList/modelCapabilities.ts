import type { ModelCapabilitiesSchema } from '@ant-chat/shared'

/** 输入模态展示文案；AddModelForm 的选项从这里派生，避免文案分叉。 */
export const INPUT_MODALITY_LABELS = {
  text: '文本',
  image: '图片',
  pdf: 'PDF',
  video: '视频',
  audio: '音频',
} as const

/**
 * 模型能力标签：只表达差异化能力。
 * 文本输入是所有模型的默认能力，不生成标签；未标注 capabilities 的模型返回空数组。
 */
export function getModelCapabilityTags(capabilities: ModelCapabilitiesSchema | null | undefined): string[] {
  if (!capabilities) {
    return []
  }

  const tags: string[] = []
  if (capabilities.functionCall) {
    tags.push('工具调用')
  }
  if (capabilities.reasoning) {
    tags.push('推理')
  }
  for (const modality of capabilities.inputModalities ?? []) {
    if (modality === 'text') {
      continue
    }
    tags.push(INPUT_MODALITY_LABELS[modality])
  }
  return tags
}
