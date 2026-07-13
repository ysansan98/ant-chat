import type { ProviderConfigModelSchema } from '@ant-chat/shared'
import { useEffect, useMemo, useState } from 'react'
import { providerApi } from '@/api/providerApi'

const MODALITY_ACCEPT_MAP: Record<string, string> = {
  text: 'text/*,.md,.csv,.txt,.json',
  image: 'image/*',
  pdf: 'application/pdf',
  video: 'video/*',
  audio: 'audio/*',
}

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

  const fileAccept = useMemo(
    () => buildAcceptFromModalities(modelInfo?.capabilities?.inputModalities ?? []),
    [modelInfo?.capabilities?.inputModalities],
  )

  return {
    modelInfo,
    fileAccept,
    contextLength: modelInfo?.contextLength ?? 1,
  }
}
