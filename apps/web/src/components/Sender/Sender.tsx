import type { AgentMode, IMessageContent } from '@ant-chat/shared'
import type { SenderPromptMessage } from './senderSubmission'
import { useRef, useState } from 'react'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import {
  useChatSttingsStore,
} from '@/store/chatSettings'
import { useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import TypingEffect from '../TypingEffect'
import { SenderComposer } from './SenderComposer'
import { useSenderModel } from './senderModel'
import { buildMessageContent } from './senderSubmission'
import { SenderWorkspacePicker } from './SenderWorkspacePicker'
import { useReferenceInputController } from './useReferenceInputController'
import { useSenderWorkspace } from './useSenderWorkspace'

interface SenderProps {
  disabled?: boolean
  onSubmit?: (
    messageContent: IMessageContent,
    agentMode: AgentMode,
  ) => Promise<boolean | void> | boolean | void
  onCancel?: () => void
  canInjectPendingMessage?: boolean
  onInjectPendingMessage?: (id: string) => void
  onEditPendingMessage?: (id: string, text: string) => void
  onRemovePendingMessage?: (id: string) => void
}

function Sender({ disabled = false, ...props }: SenderProps) {
  const senderRef = useRef<HTMLDivElement | null>(null)
  const [notice, setNotice] = useState('')
  const { settings } = useChatSettingsContext()
  const workspace = useSenderWorkspace()
  const model = useSenderModel(settings.modelId, settings.providerId)
  const referenceInput = useReferenceInputController({
    containerRef: senderRef,
    workspacePath: workspace.currentPath,
  })

  const activeConversationId = useMessagesStore(state => state.activeConversationsId)
  const hasMessage = useMessagesStore(state => !!state.messages.length)
  const loading = useConversationsStore(
    state => state.conversationStates[state.activeConversationsId] === 'running',
  )
  const agentMode = useChatSttingsStore(state => state.agentMode)

  async function handleSubmit(message: SenderPromptMessage) {
    const content = await buildMessageContent(message)
    const submitted = await props.onSubmit?.(content, agentMode)
    if (submitted === false) {
      return
    }

    referenceInput.reset()
    requestAnimationFrame(() => {
      referenceInput.textareaRef.current?.focus()
    })
  }

  return (
    <div
      ref={senderRef}
      className="mx-auto w-full max-w-(--chat-width)"
    >
      {!hasMessage && (
        <h1 className="mb-3 py-3 text-center text-2xl text-balance text-muted-foreground md:text-4xl">
          <TypingEffect text="有什么可以帮忙的？" />
        </h1>
      )}

      {!activeConversationId && !hasMessage && (
        <SenderWorkspacePicker {...workspace} />
      )}

      <SenderComposer
        conversationId={activeConversationId}
        canInjectPendingMessage={props.canInjectPendingMessage ?? false}
        onInjectPendingMessage={id => props.onInjectPendingMessage?.(id)}
        onEditPendingMessage={(id, text) => props.onEditPendingMessage?.(id, text)}
        onRemovePendingMessage={id => props.onRemovePendingMessage?.(id)}
        referenceInput={referenceInput}
        fileAccept={model.fileAccept}
        contextLength={model.contextLength}
        disabled={disabled}
        loading={loading}
        onError={(message) => {
          setNotice(message)
        }}
        onSubmit={async (message) => {
          setNotice('')
          await handleSubmit(message)
        }}
        onCancel={props.onCancel}
      />

      {(notice || workspace.error) && (
        <div className="mt-2 text-xs text-red-500">{notice || workspace.error}</div>
      )}
    </div>
  )
}

export default Sender
