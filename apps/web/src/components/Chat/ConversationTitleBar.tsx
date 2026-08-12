import type { IConversations } from '@ant-chat/shared'
import { PencilIcon } from 'lucide-react'
import { useState } from 'react'
import { useSidebar } from '@/contexts/sidebar'
import { renameConversationsAction } from '@/store/conversation'

interface ConversationTitleBarProps {
  conversation: IConversations
}

export function ConversationTitleBar({ conversation }: ConversationTitleBarProps) {
  const { showSliderMenu } = useSidebar()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(conversation.title)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit() {
    const nextTitle = title.trim()
    if (!nextTitle || nextTitle === conversation.title) {
      setTitle(conversation.title)
      setEditing(false)
      return
    }

    setSubmitting(true)
    try {
      await renameConversationsAction(conversation.id, nextTitle)
      setEditing(false)
    }
    catch {
      setTitle(conversation.title)
      setEditing(false)
    }
    finally {
      setSubmitting(false)
    }
  }

  function handleCancel() {
    setTitle(conversation.title)
    setEditing(false)
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void handleSubmit()
    }
    else if (event.key === 'Escape') {
      handleCancel()
    }
  }

  return (
    <div className={`flex h-10 shrink-0 items-center border-b border-border/60 px-4 ${showSliderMenu ? '' : 'pl-45'}`}>
      <div className="group flex min-w-0 flex-1 items-center gap-2">
        {editing
          ? (
              <input
                type="text"
                value={title}
                className="h-8 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 text-sm font-semibold outline-hidden focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                onChange={event => setTitle(event.target.value)}
                onBlur={handleSubmit}
                onKeyDown={handleKeyDown}
                autoFocus
                disabled={submitting}
              />
            )
          : (
              <>
                <span className="truncate text-sm font-medium">
                  {conversation.title}
                </span>
                <button
                  type="button"
                  className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent hover:text-foreground focus-visible:opacity-100"
                  onClick={() => setEditing(true)}
                  aria-label="重命名"
                >
                  <PencilIcon className="size-3.5" />
                </button>
              </>
            )}
      </div>
    </div>
  )
}
