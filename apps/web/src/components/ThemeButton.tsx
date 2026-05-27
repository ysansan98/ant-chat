import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import {
  CloudSunIcon,
  MoonIcon,
  SunIcon,
} from 'lucide-react'
import { useState } from 'react'
import { useThemeStore } from '@/store/theme'
import { SidebarNavItem } from './SiliderMenu/SliderMenuItem'

const options = [
  { id: 'auto' as const, label: '跟随系统' },
  { id: 'light' as const, label: '亮色主题' },
  { id: 'dark' as const, label: '暗黑主题' },
]

type ThemeMode = (typeof options)[number]['id']

function ThemeIcon({ mode }: { mode: ThemeMode }): ReactNode {
  if (mode === 'light') {
    return <SunIcon className="size-4" />
  }
  if (mode === 'dark') {
    return <MoonIcon className="size-4" />
  }
  return <CloudSunIcon className="size-4" />
}

interface ThemeOptionsPanelProps {
  mode: ThemeMode
  onSelect: (mode: ThemeMode) => void
}

function ThemeOptionsPanel({ mode, onSelect }: ThemeOptionsPanelProps) {
  return (
    <div className="flex flex-col gap-1">
      {options.map((item) => {
        const active = mode === item.id

        return (
          <Button
            key={item.id}
            type="button"
            variant={active ? 'secondary' : 'ghost'}
            className="h-8 w-full justify-start px-2 text-sm"
            onClick={() => onSelect(item.id)}
          >
            <ThemeIcon mode={item.id} />
            {item.label}
          </Button>
        )
      })}
    </div>
  )
}

function ThemeButton() {
  const { mode, setThemeMode } = useThemeStore()
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-9"
          aria-label="选择主题"
        >
          <ThemeIcon mode={mode} />
        </Button>
      </PopoverTrigger>

      <PopoverContent side="right" align="start" className="w-36 p-1" sideOffset={8}>
        <ThemeOptionsPanel
          mode={mode}
          onSelect={(nextMode) => {
            setThemeMode(nextMode)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export default ThemeButton

export function ThemeMenuItem() {
  const { mode, setThemeMode } = useThemeStore()
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div className="inline-flex w-fit">
          <SidebarNavItem
            icon={<ThemeIcon mode={mode} />}
            label="主题"
          />
        </div>
      </PopoverTrigger>

      <PopoverContent side="right" align="start" className="w-44 p-1" sideOffset={8}>
        <ThemeOptionsPanel
          mode={mode}
          onSelect={(nextMode) => {
            setThemeMode(nextMode)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
