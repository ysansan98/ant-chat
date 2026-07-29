import type { SenderWorkspaceController } from './useSenderWorkspace'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { ChevronDown, FolderOpenIcon } from 'lucide-react'

export function SenderWorkspacePicker({
  displayName,
  workspaces,
  canSelect,
  loading,
  pickerOpen,
  setPickerOpen,
  switchWorkspace,
}: SenderWorkspaceController) {
  const disabled = loading || !canSelect

  return (
    <div className="mx-auto flex w-[95%] items-center rounded-t-xl bg-secondary/50 px-3 py-1">
      <Popover
        open={canSelect ? pickerOpen : false}
        onOpenChange={(next) => {
          if (canSelect) {
            setPickerOpen(next)
          }
        }}
      >
        <PopoverTrigger render={(
          <Button
            variant="ghost"
            data-testid="workspace-switcher"
            disabled={loading}
            aria-disabled={disabled}
            aria-label={`工作区：${displayName}`}
            className={`
              h-8 max-w-52 justify-start border px-2
              max-sm:size-8 max-sm:justify-center max-sm:gap-0 max-sm:px-0
              ${disabled ? 'pointer-events-none opacity-100 hover:bg-transparent' : ''}
            `}
          >
            <FolderOpenIcon className="size-4 shrink-0" />
            <span className="truncate max-sm:hidden">{displayName}</span>
            <ChevronDown className="size-3.5" />
          </Button>
        )}
        />
        <PopoverContent align="start" className="w-64 p-1">
          <div className="max-h-60 overflow-y-auto">
            {workspaces.map(item => (
              <button
                key={item.path}
                type="button"
                className="
                  flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm
                  hover:bg-accent hover:text-accent-foreground
                "
                onClick={() => {
                  void switchWorkspace(item.path)
                }}
              >
                <FolderOpenIcon className="size-4 shrink-0" />
                <span className="truncate">{item.displayName}</span>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
