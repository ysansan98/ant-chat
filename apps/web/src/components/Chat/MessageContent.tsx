import type { AttachmentData } from '@workspace/ui/components/ai-elements/attachments'
import type { BubbleContent } from '@/types/global'
import {
  Attachment,
  AttachmentHoverCard,
  AttachmentHoverCardContent,
  AttachmentHoverCardTrigger,
  AttachmentInfo,
  AttachmentPreview,
  Attachments,
} from '@workspace/ui/components/ai-elements/attachments'
import { MessageResponse } from '@workspace/ui/components/ai-elements/message'
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '@workspace/ui/components/ai-elements/reasoning'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { FileIcon, Loader2Icon, SparklesIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { skillApi } from '@/api/skillApi'
import { tokenizeMessageReferences } from './messageReferenceTokens'

function toAttachmentData(item: NonNullable<BubbleContent['attachments']>[number]): AttachmentData {
  return {
    type: 'file',
    id: item.uid,
    filename: item.name,
    mediaType: item.type,
    url: item.data,
  }
}

function getAttachmentUrl(item: AttachmentData): string {
  if (item.type === 'source-document') {
    return ''
  }

  return item.url || ''
}

const EMPTY_IMAGES: NonNullable<BubbleContent['images']> = []
const EMPTY_ATTACHMENTS: NonNullable<BubbleContent['attachments']> = []

export default function MessageContent({ content = '', images = EMPTY_IMAGES, attachments = EMPTY_ATTACHMENTS, reasoningContent = '', status, enableReferenceTokens = false }: Partial<BubbleContent> & { enableReferenceTokens?: boolean }) {
  if (status === 'error') {
    return (
      <Alert variant="destructive">
        <AlertDescription>
          <p>Request failed. Check your configuration and try again.</p>
          {content && <p className="mt-2 whitespace-pre-wrap">{content}</p>}
        </AlertDescription>
      </Alert>
    )
  }

  if (status === 'cancel') {
    return (
      <Alert variant="default">
        <AlertDescription>
          {content && <p className="whitespace-pre-wrap">{content}</p>}
        </AlertDescription>
      </Alert>
    )
  }

  const isStreaming = status === 'loading' || status === 'typing'
  const imageItems = images.map(toAttachmentData)
  const attachmentItems = attachments.map(toAttachmentData)

  return (
    <div className="space-y-3">
      {reasoningContent && (
        <Reasoning isStreaming={isStreaming}>
          <ReasoningTrigger
            getThinkingMessage={streaming => (
              <span className="inline-flex items-center gap-1">
                {streaming ? 'Thinking' : 'Thought complete'}
                {streaming && <Loader2Icon className="size-3 animate-spin" />}
              </span>
            )}
          />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      )}

      {content && (
        enableReferenceTokens
          ? <ReferenceTokenMessage content={content} />
          : <MessageResponse isAnimating={isStreaming}>{content}</MessageResponse>
      )}

      {imageItems.length > 0 && (
        <Attachments variant="grid" className="ml-0">
          {imageItems.map(item => (
            <AttachmentHoverCard key={item.id}>
              <AttachmentHoverCardTrigger asChild>
                <Attachment data={item}>
                  <AttachmentPreview />
                </Attachment>
              </AttachmentHoverCardTrigger>
              <AttachmentHoverCardContent>
                <img
                  src={getAttachmentUrl(item)}
                  alt={item.filename || 'Image'}
                  className="max-h-[360px] max-w-[520px] rounded-md object-contain"
                />
              </AttachmentHoverCardContent>
            </AttachmentHoverCard>
          ))}
        </Attachments>
      )}

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
  const [skillDescriptions, setSkillDescriptions] = useState<Record<string, string>>({})
  const skillNames = useMemo(
    () => tokenizeMessageReferences(content)
      .filter(part => part.type === 'skill')
      .map(part => part.value),
    [content],
  )

  useEffect(() => {
    if (skillNames.length === 0) {
      return
    }

    void skillApi.listSkills()
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
            <TooltipTrigger asChild>
              <span
                className="
                  inline-flex max-w-full translate-y-[2px] items-center gap-1 rounded-md border
                  bg-muted px-1.5 py-0.5 text-xs text-foreground
                "
              >
                {isFile
                  ? <FileIcon className="size-3 shrink-0" />
                  : <SparklesIcon className="size-3 shrink-0" />}
                <span className="max-w-72 truncate">{part.text}</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {isFile ? part.value : (skillDescriptions[part.value] || `Skill: ${part.value}`)}
            </TooltipContent>
          </Tooltip>
        )
      })}
    </p>
  )
}
