import type { AgentMode } from '@ant-chat/shared'
import {
  PromptInputButton,
  PromptInputTools,
} from '@workspace/ui/components/ai-elements/prompt-input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { Check, ChevronDownIcon, HandIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import {
  setAgentMode,
  useChatSttingsStore,
} from '@/store/chatSettings'
import { ModelControlPanel } from './PickerModel'
import { SenderAddAttachmentButton } from './SenderAttachments'
import { SenderContextUsageButton } from './SenderContextUsageButton'

const AGENT_MODE_OPTIONS: Array<{ value: AgentMode, label: string, icon: React.ReactNode }> = [
  { value: 'strict', label: '默认权限', icon: <HandIcon className="size-4" /> },
  { value: 'hybrid', label: '自动审查', icon: <ShieldCheckIcon className="size-4" /> },
  { value: 'full_managed', label: '完全访问权限', icon: <ShieldAlertIcon className="size-4" /> },
]

interface SenderToolbarProps {
  fileAccept: string
  contextLength: number
}

export function SenderToolbar({ fileAccept, contextLength }: SenderToolbarProps) {
  const { settings, updateSettings } = useChatSettingsContext()
  const agentMode = useChatSttingsStore(state => state.agentMode)
  const currentAgentModeOption = AGENT_MODE_OPTIONS.find(item => item.value === agentMode) || AGENT_MODE_OPTIONS[1]

  return (
    <PromptInputTools className="scroll-hidden w-full justify-between overflow-visible">
      <div className="flex items-center gap-1">
        <SenderAddAttachmentButton accept={fileAccept} />
        <SenderContextUsageButton contextLength={contextLength} />

        <Popover>
          <PopoverTrigger render={(
            <PromptInputButton
              size="sm"
              type="button"
              variant="ghost"
              aria-label={`权限模式：${currentAgentModeOption.label}`}
              className={agentMode === 'full_managed' ? 'text-destructive' : ''}
            >
              {currentAgentModeOption.icon}
              <span className="max-sm:hidden">{currentAgentModeOption.label}</span>
              <ChevronDownIcon className="size-3 max-sm:hidden" />
            </PromptInputButton>
          )}
          />
          <PopoverContent align="start" className="w-52 p-1">
            {AGENT_MODE_OPTIONS.map(item => (
              <button
                key={item.value}
                type="button"
                className="
                  flex h-8 w-full items-center justify-between rounded-md px-2 text-sm
                  hover:bg-accent hover:text-accent-foreground
                "
                onClick={() => setAgentMode(item.value)}
              >
                <span className={`flex items-center gap-2 ${item.value === 'full_managed' ? 'text-destructive' : ''}`}>
                  {item.icon}
                  {item.label}
                </span>
                {item.value === agentMode ? <Check className="ml-auto size-3.5 text-primary" /> : null}
              </button>
            ))}
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-1">
        <ModelControlPanel
          value={{ modelId: settings.modelId, providerId: settings.providerId }}
          onChange={({ modelId, providerId, maxOutputTokens, temperature }) => {
            updateSettings({ modelId, providerId, maxOutputTokens, temperature })
          }}
          reasoningEffort={settings.reasoningEffort}
          onReasoningEffortChange={value => updateSettings({ reasoningEffort: value })}
        />
      </div>
    </PromptInputTools>
  )
}
