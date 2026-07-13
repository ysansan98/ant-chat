import type { LanguageModelUsage } from '@ant-chat/shared'
import { calculateContextTokens } from '@ant-chat/shared'
import {
  ContextUsage,
  ContextUsageBody,
  ContextUsageCache,
  ContextUsageContent,
  ContextUsageHeader,
  ContextUsageInput,
  ContextUsageOutput,
  ContextUsageReasoning,
  ContextUsageTrigger,
} from '@workspace/ui/components/context-usage'
import { useMemo } from 'react'
import { useMessagesStore } from '@/store/messages'
import { calculateSessionUsage } from './sessionUsage'

export function SenderContextUsageButton({ contextLength }: { contextLength: number }) {
  const messages = useMessagesStore(state => state.messages)

  const sessionUsage = useMemo(
    (): LanguageModelUsage | undefined => calculateSessionUsage(messages),
    [messages],
  )

  const usedTokens = useMemo(() => {
    const entries = messages.map(msg => ({
      message: msg,
      usage: msg.usage,
      status: msg.status,
    }))
    return calculateContextTokens(entries)
  }, [messages])

  const hasUsage = sessionUsage !== undefined

  return (
    <ContextUsage
      contextLength={contextLength}
      usage={sessionUsage}
      usedTokens={Math.max(0, usedTokens)}
    >
      <ContextUsageTrigger
        size="sm"
        type="button"
        variant="ghost"
      />
      <ContextUsageContent align="start" className="w-72">
        <ContextUsageHeader />
        <ContextUsageBody className="space-y-2">
          {hasUsage
            ? (
                <>
                  <ContextUsageInput />
                  <ContextUsageOutput />
                  <ContextUsageReasoning />
                  <ContextUsageCache />
                </>
              )
            : (
                <div className="text-xs text-muted-foreground">暂无用量</div>
              )}
        </ContextUsageBody>
      </ContextUsageContent>
    </ContextUsage>
  )
}
