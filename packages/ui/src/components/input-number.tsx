import { Input } from '@workspace/ui/components/input'
import { cn } from '@workspace/ui/lib/utils'
import * as React from 'react'

function InputNumber({
  className,
  min,
  max,
  step,
  ...props
}: React.ComponentProps<typeof Input> & {
  min?: number
  max?: number
  step?: number
}) {
  return (
    <Input
      type="number"
      data-slot="input-number"
      className={cn('[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none', className)}
      min={min}
      max={max}
      step={step}
      {...props}
    />
  )
}

export { InputNumber }
