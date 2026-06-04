import { useCallback, useRef, useState } from 'react'
import { toast } from 'sonner'
import chatApi from '@/api/chatApi'
import commandsApi from '@/api/commandsApi'
import { parseBuiltinCommand } from '@/components/Sender/builtinCommandParser'
import { upsertConversationAction } from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'

interface UseBuiltinCommandSubmitOptions {
  settings: {
    modelId: string
    systemPrompt?: string
    temperature?: number
    maxTokens?: number
  }
  currentWorkspacePath?: string
}

/** Minimum duration (ms) to show the loading indicator for perceptible feedback. */
const MIN_LOADING_MS = 600

export function useBuiltinCommandSubmit(options: UseBuiltinCommandSubmitOptions) {
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const [commandRunning, setCommandRunning] = useState(false)
  const runningRef = useRef(false)

  const submitCommand = useCallback(async (
    draftText: string,
    referencedFiles: string[],
    selectedSkill: string | undefined,
  ): Promise<boolean> => {
    const command = parseBuiltinCommand(draftText, referencedFiles, selectedSkill)
    if (!command) {
      return false
    }

    const startTime = Date.now()
    runningRef.current = true
    setCommandRunning(true)

    try {
      const result = await commandsApi.runBuiltinCommand({
        id: command.id,
        conversationId: activeConversationsId || undefined,
        argument: command.argument,
        modelConfig: {
          modelId: options.settings.modelId,
          systemPrompt: options.settings.systemPrompt || '',
          temperature: options.settings.temperature || 0.7,
          maxTokens: options.settings.maxTokens || 4096,
        },
        workspacePath: options.currentWorkspacePath || '',
      })

      if (result.conversation) {
        upsertConversationAction(result.conversation)
        await setActiveConversationsId(result.conversation.id)
      }

      if (command.id === 'compact' && activeConversationsId) {
        const updatedConv = await chatApi.getConversationById(activeConversationsId)
        upsertConversationAction(updatedConv)
        await setActiveConversationsId(activeConversationsId)
      }

      // Ensure the loading indicator is visible for at least MIN_LOADING_MS
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_LOADING_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_LOADING_MS - elapsed))
      }

      return true
    }
    catch (error) {
      const elapsed = Date.now() - startTime
      if (elapsed < MIN_LOADING_MS) {
        await new Promise(resolve => setTimeout(resolve, MIN_LOADING_MS - elapsed))
      }
      toast.error((error as Error).message)
      throw error
    }
    finally {
      runningRef.current = false
      setCommandRunning(false)
    }
  }, [activeConversationsId, options.settings, options.currentWorkspacePath])

  const cancelCommand = useCallback(() => {
    if (activeConversationsId) {
      commandsApi.cancelCommand(activeConversationsId)
    }
  }, [activeConversationsId])

  return { commandRunning, submitCommand, cancelCommand }
}
