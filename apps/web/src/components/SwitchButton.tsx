import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { useTheme } from '@workspace/ui/hooks/use-theme'
import React from 'react'

interface SwitchButtonProps {
  checked: boolean
  icon: React.ReactNode
  dataTestId?: string
  onChange?: (checked: boolean) => void
  popoverContent?: React.ReactNode
}

function SwitchButton({
  checked,
  icon,
  dataTestId,
  onChange,
  popoverContent,
}: SwitchButtonProps) {
  const { token } = useTheme()

  const buttonElement = (
    <div
      role="switch"
      aria-checked={checked}
      tabIndex={0}
      data-testid={dataTestId}
      className={`
        flex size-8 cursor-pointer items-center justify-center rounded-lg border border-solid
        transition-colors
      `}
      style={{
        color: checked ? token.colorPrimary : 'var(--foreground)',
        borderColor: checked ? token.colorPrimary : 'var(--border)',
      }}
      onClick={() => onChange?.(!checked)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onChange?.(!checked)
        }
      }}
    >
      {icon}
    </div>
  )

  if (popoverContent) {
    return (
      <Popover>
        <PopoverTrigger asChild>{buttonElement}</PopoverTrigger>
        <PopoverContent>
          {popoverContent}
        </PopoverContent>
      </Popover>
    )
  }

  return buttonElement
}

export default SwitchButton
