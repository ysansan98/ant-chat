import type { FileUIPart } from 'ai'
import type { ReferenceInputController } from './useReferenceInputController'
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputTextarea,
} from '@workspace/ui/components/ai-elements/prompt-input'
import { PendingMessageQueue } from './PendingMessageQueue'
import { ReferenceInputOverlay } from './ReferenceInputOverlay'
import { ReferenceSuggestionPanel } from './ReferenceSuggestionPanel'
import { SenderAnnotationPreview } from './SenderAnnotationPreview'
import { SenderAttachmentsPreview } from './SenderAttachments'
import { SenderSubmitButton } from './SenderSubmitButton'
import { SenderToolbar } from './SenderToolbar'

interface SenderComposerProps {
  conversationId: string
  canInjectPendingMessage: boolean
  onInjectPendingMessage: (id: string) => void
  onEditPendingMessage: (id: string, text: string) => void
  onRemovePendingMessage: (id: string) => void
  referenceInput: ReferenceInputController
  fileAccept: string
  contextLength: number
  disabled: boolean
  loading: boolean
  onError: (message: string) => void
  onSubmit: (message: { text: string, files: FileUIPart[] }) => Promise<void>
  onCancel?: () => void
}

export function SenderComposer({
  conversationId,
  canInjectPendingMessage,
  onInjectPendingMessage,
  onEditPendingMessage,
  onRemovePendingMessage,
  referenceInput,
  fileAccept,
  contextLength,
  disabled,
  loading,
  onError,
  onSubmit,
  onCancel,
}: SenderComposerProps) {
  const { textareaRef, draft, onChange, onClick, onKeyDown, onKeyUp, onScroll } = referenceInput
  return (
    <div className="overflow-hidden rounded-xl bg-secondary">
      <PendingMessageQueue
        conversationId={conversationId}
        canInject={canInjectPendingMessage}
        onInject={onInjectPendingMessage}
        onEdit={onEditPendingMessage}
        onRemove={onRemovePendingMessage}
      />

      <PromptInput
        accept={fileAccept}
        className="rounded-xl bg-background"
        data-testid="chat-input-form"
        maxFileSize={5 * 1024 * 1024}
        multiple
        onError={({ message }) => onError(message)}
        onSubmit={onSubmit}
      >
        <PromptInputBody className="bg-transparent px-1 pt-1">
          <SenderAnnotationPreview />
          <SenderAttachmentsPreview />
          <div className="relative w-full">
            <ReferenceInputOverlay
              text={referenceInput.draft}
              confirmedFileReferences={referenceInput.confirmedFileReferences}
              confirmedSkillReference={referenceInput.confirmedSkillReference}
              scrollTop={referenceInput.scrollTop}
            />
            <PromptInputTextarea
              ref={textareaRef}
              className="
                relative z-10 max-h-48 min-h-20 border-0 bg-transparent p-1 text-sm
                text-transparent caret-foreground
                selection:bg-primary/20 selection:text-foreground
                placeholder:text-muted-foreground
                md:min-h-18
              "
              data-testid="chat-input"
              disabled={disabled}
              value={draft}
              onChange={onChange}
              onClick={onClick}
              onKeyDown={onKeyDown}
              onKeyUp={onKeyUp}
              onScroll={onScroll}
              placeholder={disabled
                ? '指令执行中...'
                : loading
                  ? '输入追加指令，Enter发送'
                  : 'Enter发送消息，Shift+Enter换行'}
            />
          </div>
          <ReferenceSuggestionPanel
            trigger={referenceInput.trigger}
            directories={referenceInput.directories}
            files={referenceInput.files}
            skills={referenceInput.skills}
            builtinCommands={referenceInput.builtinCommands}
            hasWorkspace={referenceInput.hasWorkspace}
            canGoParent={referenceInput.canGoParent}
            highlightedIndex={referenceInput.highlightedIndex}
            anchorRect={referenceInput.anchorRect}
            onSelectFile={referenceInput.onSelectFile}
            onSelectDirectory={referenceInput.onSelectDirectory}
            onSelectParent={referenceInput.onSelectParent}
            onSelectSkill={referenceInput.onSelectSkill}
            onSelectCommand={referenceInput.onSelectCommand}
            onSetHighlightedIndex={referenceInput.onSetHighlightedIndex}
          />
        </PromptInputBody>

        <PromptInputFooter className="flex min-w-0 items-center gap-2">
          <SenderToolbar fileAccept={fileAccept} contextLength={contextLength} />
          <SenderSubmitButton
            loading={loading}
            disabled={disabled}
            hasDraft={Boolean(referenceInput.draft.trim())}
            onCancel={onCancel}
          />
        </PromptInputFooter>
      </PromptInput>
    </div>
  )
}
