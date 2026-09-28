import type { ModelCapabilitiesSchema } from '@ant-chat/shared'

/** 输入模态展示文案；AddModelForm 的选项从这里派生，避免文案分叉。 */
export const INPUT_MODALITY_LABELS = {
  text: '文本',
  image: '图片',
  pdf: 'PDF',
  video: '视频',
  audio: '音频',
} as const

/** 可手动标注的输入模态选项。 */
export const INPUT_MODALITY_OPTIONS = Object.entries(INPUT_MODALITY_LABELS)
  .map(([value, label]) => ({ value, label }))

/** 输出模态展示文案（只列差异化输出；文本输出是默认能力，不在此标注）。 */
export const OUTPUT_MODALITY_LABELS = {
  image: '图片',
  video: '视频',
} as const

/** 可手动标注的输出模态选项（AddModelForm 从这里派生）。 */
export const OUTPUT_MODALITY_OPTIONS = Object.entries(OUTPUT_MODALITY_LABELS)
  .map(([value, label]) => ({ value: value as keyof typeof OUTPUT_MODALITY_LABELS, label }))

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
  // 输出模态加「生成」后缀，与输入模态标签区分（生图/生视频模型在列表中可辨识）。
  for (const modality of capabilities.outputModalities ?? []) {
    const label = OUTPUT_MODALITY_LABELS[modality as keyof typeof OUTPUT_MODALITY_LABELS]
    if (label) {
      tags.push(`${label}生成`)
    }
  }
  return tags
}
