import type { IAttachment, IMessage } from '@ant-chat/shared'
import type { AttachmentData } from '@workspace/ui/components/ai-elements/attachments'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '@workspace/ui/components/ai-elements/attachments'
import { MessageResponse } from '@workspace/ui/components/ai-elements/message'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@workspace/ui/components/tooltip'
import { FileIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { skillApi } from '@/api/skillApi'
import { attachmentToPreviewItem } from './imagePreviewItem'
import { ImageViewer } from './ImageViewer'
import { tokenizeMessageReferences } from './messageReferenceTokens'

function toAttachmentData(
  item: IAttachment,
): AttachmentData {
  return {
    type: 'file',
    id: item.uid,
    filename: item.name,
    mediaType: item.type,
    url: item.data,
  }
}

const EMPTY_IMAGES: IAttachment[] = []
const EMPTY_ATTACHMENTS: IAttachment[] = []

interface MessageContentProps {
  content?: string
  status?: IMessage['status']
  enableReferenceTokens?: boolean
}

/** 气泡内的文本渲染层：附件块（image/document/file）不在这里渲染。 */
export default function MessageContent({
  content = '',
  status,
  enableReferenceTokens = false,
}: MessageContentProps) {
  const isStreaming = status === 'loading' || status === 'typing'

  return (
    <div className="space-y-3">
      {content
        && (enableReferenceTokens
          ? (
              <ReferenceTokenMessage content={content} />
            )
          : (
              <MessageResponse isAnimating={isStreaming}>{content}</MessageResponse>
            ))}
    </div>
  )
}

/**
 * 气泡下方的附件渲染区：图片缩略图 + 文件/文档元信息卡片。
 * 与气泡内文本层分离，避免同一附件被占位文本和真实渲染双重展示。
 */
export function MessageAttachments({
  images = EMPTY_IMAGES,
  attachments = EMPTY_ATTACHMENTS,
}: {
  images?: IAttachment[]
  attachments?: IAttachment[]
}) {
  const imageItems = images.map(attachmentToPreviewItem)
  const attachmentItems = attachments.map(toAttachmentData)

  if (imageItems.length === 0 && attachmentItems.length === 0) {
    return null
  }

  return (
    <div className="space-y-2">
      <ImageViewer items={imageItems} />
      {attachmentItems.length > 0 && (
        <Attachments variant="list">
          {attachmentItems.map(item => (
            <Attachment data={item} key={item.id}>
              <AttachmentPreview />
              <AttachmentInfo showMediaType />
            </Attachment>
          ))}
        </Attachments>
      )}
    </div>
  )
}

function ReferenceTokenMessage({ content }: { content: string }) {
  const [skillDescriptions, setSkillDescriptions] = useState<
    Record<string, string>
  >({})
  const skillNames = useMemo(
    () =>
      tokenizeMessageReferences(content)
        .filter(part => part.type === 'skill')
        .map(part => part.value),
    [content],
  )

  useEffect(() => {
    if (skillNames.length === 0) {
      return
    }

    void skillApi
      .listSkills()
      .then((data) => {
        const next: Record<string, string> = {}
        for (const skill of data.skills) {
          if (skill.description) {
            next[skill.name] = skill.description
          }
        }
        setSkillDescriptions(next)
      })
      .catch(() => {})
  }, [skillNames])

  return (
    <p className="wrap-break-word whitespace-pre-wrap">
      {tokenizeMessageReferences(content).map((part) => {
        if (part.type === 'text') {
          return <span key={`text-${part.offset}`}>{part.text}</span>
        }

        const isFile = part.type === 'file'
        return (
          <Tooltip key={`${part.type}-${part.offset}-${part.value}`}>
            <TooltipTrigger
              render={(
                <span
                  className="
                  inline-flex max-w-full translate-y-0.5 items-center gap-1 rounded-md border
                  bg-muted px-1.5 py-0.5 text-xs text-foreground
                "
                >
                  {isFile
                    ? (
                        <FileIcon className="size-3 shrink-0" />
                      )
                    : (
                        <SparklesIcon className="size-3 shrink-0" />
                      )}
                  <span className="max-w-72 truncate">{part.text}</span>
                </span>
              )}
            />
            <TooltipContent side="top">
              {isFile
                ? part.value
                : skillDescriptions[part.value] || `Skill: ${part.value}`}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </p>
  )
}
