import type { IAttachment } from '@ant-chat/shared'
import { useEffect, useState } from 'react'
import { getAppRpcClient } from '@/api/transports/appRpc'

/** 图片预览所需的字段 */
export interface ImagePreviewItem {
  id: string
  url: string
  filename?: string
  fileId?: string
  mediaType?: string
}

/**
 * 将 IAttachment 转换为 ImagePreviewItem。
 * 有 base64 data URL 时直接使用；否则保留 uid（= fileId）供 RPC 异步加载。
 */
export function attachmentToPreviewItem(
  item: IAttachment,
): ImagePreviewItem {
  const isDataUrl = item.data?.startsWith('data:')

  return {
    id: item.uid,
    url: isDataUrl ? item.data : '',
    filename: item.name,
    fileId: isDataUrl ? undefined : item.uid,
    mediaType: item.type,
  }
}

/**
 * 异步加载附件图片。有 data URL 直接使用，否则通过 RPC 加载。
 */
export function useAttachmentUrl(item: ImagePreviewItem): string {
  const [url, setUrl] = useState(item.url)

  useEffect(() => {
    if (item.url || !item.fileId) {
      return
    }

    let cancelled = false

    getAppRpcClient()
      .call('files.getAttachmentData', { fileId: item.fileId })
      .then((base64) => {
        if (cancelled || !base64) {
          return
        }
        setUrl(`data:${item.mediaType || 'image/png'};base64,${base64}`)
      })
      .catch(() => { /* silent */ })

    return () => {
      cancelled = true
    }
  }, [item.fileId, item.mediaType, item.url])

  return url
}
