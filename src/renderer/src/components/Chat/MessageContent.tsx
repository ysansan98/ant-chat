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
import { Loader2Icon } from 'lucide-react'

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

export default function MessageContent({ content = '', images = [], attachments = [], reasoningContent = '', status }: Partial<BubbleContent>) {
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

      {content && <MessageResponse isAnimating={isStreaming}>{content}</MessageResponse>}

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
