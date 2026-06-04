import { useCallback, useState } from 'react'
import { toast } from 'sonner'
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

/**
 * Intercepts built-in commands before the regular agent turn.
 * - `commandRunning`: true while a command (e.g. /compact) is executing
 * - `submitCommand`: returns `true` if a command was handled, `false` to fall through
 */
export function useBuiltinCommandSubmit(options: UseBuiltinCommandSubmitOptions) {
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const [commandRunning, setCommandRunning] = useState(false)

  const submitCommand = useCallback(async (
    draftText: string,
    referencedFiles: string[],
    selectedSkill: string | undefined,
  ): Promise<boolean> => {
    const command = parseBuiltinCommand(draftText, referencedFiles, selectedSkill)
    if (!command) {
      return false
    }

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
        await setActiveConversationsId(activeConversationsId)
      }

      return true
    }
    catch (error) {
      toast.error((error as Error).message)
      throw error
    }
    finally {
      setCommandRunning(false)
    }
  }, [activeConversationsId, options.settings, options.currentWorkspacePath])

  return { commandRunning, submitCommand }
}
