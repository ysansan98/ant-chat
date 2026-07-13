import type { AllAvailableModelsSchema, ReasoningEffortLevel } from '@ant-chat/shared'
import type React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Check } from 'lucide-react'
import { ProviderLogoDisplay } from '@/components/Sender/renderProviderLogo'

export interface ModelSelectValue {
  modelId: string
  providerId: string
}

export interface ModelSelectProps {
  value: ModelSelectValue
  onChange?: (value: ModelSelectValue & { maxOutputTokens: number, temperature: number }) => void
  options?: AllAvailableModelsSchema[]
  /** DropdownMenuTrigger 的 className */
  className?: string
  /** trigger 内的内容 */
  children?: React.ReactNode
  /** 是否显示"清除选择"选项，设置页用 */
  allowUnset?: boolean
  /** "清除选择"选项的文案 */
  unsetLabel?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 当前推理强度档位（undefined 表示"厂商默认"，不传该参数） */
  reasoningEffort?: ReasoningEffortLevel
  /** 推理强度变更回调（undefined 表示"厂商默认"，不覆盖） */
  onReasoningEffortChange?: (value: ReasoningEffortLevel | undefined) => void
}

const REASONING_EFFORT_LABELS: Partial<Record<ReasoningEffortLevel, string>> = {
  none: '关闭',
  minimal: '极简',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '极高',
}

export function ModelSelect({
  value,
  onChange,
  options,
  className,
  children,
  allowUnset,
  unsetLabel = '清除选择',
  disabled,
  reasoningEffort,
  onReasoningEffortChange,
}: ModelSelectProps) {
  // 查找当前选中模型，判断是否支持推理强度
  const selectedProvider = options?.find(p => p.id === value.providerId)
  const selectedModel = selectedProvider?.models.find(m => m.id === value.modelId)
  const reasoningLevels = selectedModel?.capabilities?.reasoningLevels
  const hasReasoningOptions = reasoningLevels && reasoningLevels.length > 0 && onReasoningEffortChange

  // 当前选中的推理强度；undefined 表示"厂商默认"
  const currentEffort = reasoningEffort && reasoningLevels?.includes(reasoningEffort)
    ? reasoningEffort
    : undefined

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className} disabled={disabled}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options?.map(provider => (
          <DropdownMenuSub key={provider.id}>
            <DropdownMenuSubTrigger className="[&_svg]:size-3.5">
              <ProviderLogoDisplay providerId={provider.id} />
              <span className="truncate">{provider.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {provider.models.map((model) => {
                const isSelected = value.modelId === model.id && value.providerId === provider.id
                return (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => {
                      onChange?.({ modelId: model.id, providerId: model.providerId, maxOutputTokens: model.maxOutputTokens, temperature: model.temperature })
                    }}
                  >
                    <span className="">{model.name}</span>
                    {isSelected && <Check className="ml-auto size-3.5 text-primary" />}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ))}
        {allowUnset && (
          <DropdownMenuItem
            onClick={() => {
              onChange?.({ modelId: '', providerId: '', maxOutputTokens: 0, temperature: 0 })
            }}
          >
            <span className="text-muted-foreground">{unsetLabel}</span>
          </DropdownMenuItem>
        )}
        {hasReasoningOptions && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel>推理强度</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() => onReasoningEffortChange(undefined)}
              >
                <span>默认</span>
                {currentEffort === undefined && <Check className="ml-auto size-3.5 text-primary" />}
              </DropdownMenuItem>
              {reasoningLevels.map(level => (
                <DropdownMenuItem
                  key={level}
                  onClick={() => onReasoningEffortChange(level)}
                >
                  <span>{REASONING_EFFORT_LABELS[level]}</span>
                  {currentEffort === level && <Check className="ml-auto size-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
