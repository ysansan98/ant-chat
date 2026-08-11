import { Button } from '@workspace/ui/components/button'
import { Input } from '@workspace/ui/components/input'
import { MinusCircle, Plus } from 'lucide-react'
import React from 'react'

const EMPTY_ARGS: string[] = []

interface ArgsListProps {
  value?: string[]
  onChange?: (args: string[]) => void
  label?: React.ReactNode
  disabled?: boolean
}

/**
 * MCP stdio args 逐参数输入列表：一个 input 对应一个参数。
 * 最后一行显示添加按钮，其余行显示删除按钮；参数含空格（如路径）时
 * 直接原样传递，无需引号转义。
 */
export function ArgsList({ value = EMPTY_ARGS, onChange, label, disabled = false }: ArgsListProps) {
  // 至少展示一行空输入，避免空列表时没有可编辑入口。
  const items = value.length > 0 ? [...value] : ['']

  function handleChange(index: number, newValue: string) {
    const updated = [...items]
    updated[index] = newValue
    onChange?.(updated)
  }

  function handleRemove(index: number) {
    onChange?.(items.filter((_, i) => i !== index))
  }

  function handleAdd() {
    onChange?.([...items, ''])
  }

  return (
    <div className="flex flex-col gap-1">
      {label && <span className="text-sm font-medium">{label}</span>}
      {items.map((item, index) => {
        const isLast = index === items.length - 1
        return (
          // 完全受控组件（值来自外部 state），index 作 key 不存在输入框状态错位。
          // eslint-disable-next-line react/no-array-index-key
          <div key={index} className="mb-2 flex w-full items-center gap-2">
            <Input
              placeholder="参数"
              value={item}
              disabled={disabled}
              onChange={e => handleChange(index, e.target.value)}
              className="flex-1"
            />
            {!disabled && (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => (isLast ? handleAdd() : handleRemove(index))}
                aria-label={isLast ? '添加参数' : `删除参数 ${index + 1}`}
              >
                {isLast ? <Plus className="size-4" /> : <MinusCircle className="size-4" />}
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
