import {
  PromptInputButton,
  PromptInputSubmit,
} from '@workspace/ui/components/ai-elements/prompt-input'
import { LoaderCircle, Send, SquareIcon } from 'lucide-react'

interface SenderSubmitButtonProps {
  loading: boolean
  disabled: boolean
  hasDraft: boolean
  onCancel?: () => void
}

export function SenderSubmitButton({ loading, disabled, hasDraft, onCancel }: SenderSubmitButtonProps) {
  if (loading) {
    return (
      hasDraft
        ? (
            <PromptInputSubmit className="sender-primary-action" size="sm" data-testid="chat-submit" status="ready">
              <Send className="size-4" />
            </PromptInputSubmit>
          )
        : (
            <PromptInputButton className="sender-primary-action" size="icon-sm" type="button" variant="outline" data-testid="chat-cancel" onClick={onCancel}>
              <SquareIcon className="size-4" />
            </PromptInputButton>
          )
    )
  }

  return (
    <PromptInputSubmit
      size="icon-sm"
      data-testid={disabled ? 'chat-cancel' : 'chat-submit'}
      onStop={onCancel}
      status={disabled ? 'submitted' : 'ready'}
    >
      {disabled
        ? (<LoaderCircle className="size-4 animate-spin" />)
        : (<Send className="size-4" />)}
    </PromptInputSubmit>
  )
}
