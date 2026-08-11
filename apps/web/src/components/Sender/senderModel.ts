import type { ProviderConfigModelSchema } from '@ant-chat/shared'
import { useEffect, useState } from 'react'
import { providerApi } from '@/api/providerApi'

const MODALITY_ACCEPT_MAP: Record<string, string> = {
  text: 'text/*,.md,.csv,.txt,.json',
  image: 'image/*',
  pdf: 'application/pdf',
  video: 'video/*',
  audio: 'audio/*',
}

/** 按模型模态生成附件类型约束；当前阶段固定使用图片，恢复动态映射时启用。 */
export function buildAcceptFromModalities(inputModalities?: string[]): string {
  if (!inputModalities || inputModalities.length === 0)
    return ''
  return inputModalities
    .map(modality => MODALITY_ACCEPT_MAP[modality])
    .filter(Boolean)
    .join(',')
}

export function useSenderModel(modelId?: string, providerId?: string) {
  const [modelInfo, setModelInfo] = useState<ProviderConfigModelSchema | null>(null)

  useEffect(() => {
    if (!modelId || !providerId) {
      return
    }
    void providerApi.getModelInfoById(modelId, providerId).then(setModelInfo)
  }, [modelId, providerId])

  // 当前阶段仅支持图片附件：agent 对附件的处理能力只有图像识别，
  // 先固定 accept 为图片，避免用户上传文本/PDF 等暂不支持的类型。
  // 后续新增能力时按 inputModalities 恢复 MODALITY_ACCEPT_MAP 的动态映射。
  const fileAccept = 'image/*'

  return {
    modelInfo,
    fileAccept,
    contextLength: modelInfo?.contextLength ?? 1,
  }
}
