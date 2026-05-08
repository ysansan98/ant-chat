import type { SkillManifest, WorkspaceFileSearchResult } from '@ant-chat/shared'
import type { ActiveReferenceTrigger } from './inputReferences'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from '@workspace/ui/components/command'
import { FileIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ReferenceSuggestionPanelProps {
  trigger: ActiveReferenceTrigger | null
  files: WorkspaceFileSearchResult[]
  skills: SkillManifest[]
  hasWorkspace: boolean
  hasEnabledSkills: boolean
  highlightedIndex: number
  anchorRect: DOMRect | null
  onSelectFile: (file: WorkspaceFileSearchResult) => void
  onSelectSkill: (skill: SkillManifest) => void
}

export function ReferenceSuggestionPanel({
  trigger,
  files,
  skills,
  hasWorkspace,
  hasEnabledSkills,
  highlightedIndex,
  anchorRect,
  onSelectFile,
  onSelectSkill,
}: ReferenceSuggestionPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const activeItem = listRef.current?.querySelector('[data-highlighted="true"]')
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, files, skills])

  if (!trigger || !anchorRect) {
    return null
  }

  const isFile = trigger.type === 'file'
  const itemCount = isFile ? files.length : skills.length
  const emptyText = isFile
    ? hasWorkspace ? '没有匹配的工作区文件' : '未选择工作区'
    : hasEnabledSkills ? '没有匹配的 Skill' : '没有已启用的 Skill'
  const style = {
    bottom: `${Math.max(12, window.innerHeight - anchorRect.top + 8)}px`,
    left: `${anchorRect.left + 8}px`,
    width: `${Math.max(240, anchorRect.width - 16)}px`,
  }

  return createPortal(
    <div
      className="
        fixed z-50 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md
      "
      style={style}
    >
      <Command shouldFilter={false}>
        <CommandList ref={listRef} className="max-h-64">
          <CommandGroup heading={isFile ? '@ 选择工作区文件' : '/ 指定 Skill'}>
            {isFile && files.map((file, index) => (
              <CommandItem
                key={file.path}
                value={file.path}
                className="data-[highlighted=true]:bg-muted"
                data-highlighted={index === highlightedIndex}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelectFile(file)
                }}
              >
                <FileIcon className="text-muted-foreground" />
                <span className="truncate">{file.path}</span>
              </CommandItem>
            ))}

            {!isFile && skills.map((skill, index) => (
              <CommandItem
                key={skill.name}
                value={skill.name}
                className="
                  items-start
                  data-[highlighted=true]:bg-muted
                "
                data-highlighted={index === highlightedIndex}
                onMouseDown={(event) => {
                  event.preventDefault()
                  onSelectSkill(skill)
                }}
              >
                <SparklesIcon className="mt-0.5 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{skill.name}</span>
                  {skill.description && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {skill.description}
                    </span>
                  )}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>

          {itemCount === 0 && (
            <CommandEmpty className="text-muted-foreground">
              {emptyText}
            </CommandEmpty>
          )}
        </CommandList>
      </Command>
    </div>,
    document.body,
  )
}
