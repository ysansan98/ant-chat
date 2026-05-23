import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { MinusCircle, Plus } from 'lucide-react'
import React from 'react'

export interface KeyValueItem {
  key: string
  value: string
}

interface KeyValueListProps {
  value?: KeyValueItem[]
  onChange?: (items: KeyValueItem[]) => void
  label?: React.ReactNode
  keyPlaceholder?: string
  valuePlaceholder?: string
  addButtonLabel?: string
  disabled?: boolean
}

export function KeyValueList({
  value = [],
  onChange,
  label,
  keyPlaceholder = '键',
  valuePlaceholder = '值',
  addButtonLabel = '添加',
  disabled = false,
}: KeyValueListProps) {
  function handleAdd() {
    onChange?.([...value, { key: '', value: '' }])
  }

  function handleRemove(index: number) {
    onChange?.(value.filter((_, i) => i !== index))
  }

  function handleChange(index: number, field: 'key' | 'value', newValue: string) {
    const updated = value.map((item, i) =>
      i === index ? { ...item, [field]: newValue } : item,
    )
    onChange?.(updated)
  }

  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-sm font-medium">{label}</span>}
      {value.map((item, index) => (
        <div key={index} className="mb-2 flex w-full items-center gap-2">
          <Input
            placeholder={keyPlaceholder}
            value={item.key}
            disabled={disabled}
            onChange={e => handleChange(index, 'key', e.target.value)}
            className="flex-1"
          />
          <Input
            placeholder={valuePlaceholder}
            value={item.value}
            disabled={disabled}
            onChange={e => handleChange(index, 'value', e.target.value)}
            className="flex-1"
          />
          {!disabled && (
            <Button variant="ghost" size="icon-sm" onClick={() => handleRemove(index)}>
              <MinusCircle />
            </Button>
          )}
        </div>
      ))}
      {!disabled && (
        <Button
          variant="outline"
          onClick={handleAdd}
          className="w-full"
        >
          <Plus />
          {addButtonLabel}
        </Button>
      )}
    </div>
  )
}
