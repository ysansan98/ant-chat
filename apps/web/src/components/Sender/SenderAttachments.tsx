import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@workspace/ui/components/ai-elements/attachments'
import {
  PromptInputButton,
  usePromptInputAttachments,
} from '@workspace/ui/components/ai-elements/prompt-input'
import { PaperclipIcon } from 'lucide-react'

export function SenderAttachmentsPreview() {
  const attachments = usePromptInputAttachments()

  if (!attachments.files.length) {
    return null
  }

  return (
    <Attachments className="mb-2 w-full justify-start px-1 pt-1" variant="inline">
      {attachments.files.map(file => (
        <Attachment
          key={file.id}
          data={{
            id: file.id,
            type: 'file',
            mediaType: file.mediaType,
            filename: file.filename,
            url: file.url,
          }}
          onRemove={() => attachments.remove(file.id)}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  )
}

export function SenderAddAttachmentButton({ accept }: { accept: string }) {
  const attachments = usePromptInputAttachments()

  if (!accept) {
    return null
  }

  return (
    <PromptInputButton
      size="icon-xs"
      tooltip="附件(支持文档与图片)"
      onClick={() => attachments.openFileDialog()}
    >
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  )
}
