import type { AllAvailableModelsSchema } from '@ant-chat/shared'
import type React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  onChange?: (value: ModelSelectValue & { maxTokens: number, temperature: number }) => void
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
}

export function ModelSelect({
  value,
  onChange,
  options,
  className,
  children,
  allowUnset,
  unsetLabel = '清除选择',
}: ModelSelectProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={className}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {options?.map(provider => (
          <DropdownMenuSub key={provider.id}>
            <DropdownMenuSubTrigger className="[&_svg]:size-3.5">
              <ProviderLogoDisplay providerId={provider.id} />
              <span className="truncate text-xs">{provider.name}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {provider.models.map((model) => {
                const isSelected = value.modelId === model.id && value.providerId === provider.id
                return (
                  <DropdownMenuItem
                    key={model.id}
                    onClick={() => {
                      onChange?.({ modelId: model.id, providerId: model.providerId, maxTokens: model.maxTokens, temperature: model.temperature })
                    }}
                  >
                    <span className="text-xs">{model.name}</span>
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
              onChange?.({ modelId: '', providerId: '', maxTokens: 0, temperature: 0 })
            }}
          >
            <span className="text-xs text-muted-foreground">{unsetLabel}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
