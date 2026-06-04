import type { BuiltinCommand, SkillManifest, WorkspaceFileSearchResult } from '@ant-chat/shared'
import type { ActiveReferenceTrigger } from './inputReferences'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@workspace/ui/components/command'
import { FileIcon, SparklesIcon, ZapIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ReferenceSuggestionPanelProps {
  trigger: ActiveReferenceTrigger | null
  files: WorkspaceFileSearchResult[]
  skills: SkillManifest[]
  builtinCommands: BuiltinCommand[]
  hasWorkspace: boolean
  highlightedIndex: number
  anchorRect: DOMRect | null
  onSelectFile: (file: WorkspaceFileSearchResult) => void
  onSelectSkill: (skill: SkillManifest) => void
  onSelectCommand: (command: BuiltinCommand) => void
}

export function ReferenceSuggestionPanel({
  trigger,
  files,
  skills,
  builtinCommands,
  hasWorkspace,
  highlightedIndex,
  anchorRect,
  onSelectFile,
  onSelectSkill,
  onSelectCommand,
}: ReferenceSuggestionPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const activeItem = listRef.current?.querySelector('[data-highlighted="true"]')
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, files, skills, builtinCommands])

  if (!trigger || !anchorRect) {
    return null
  }

  const isFile = trigger.type === 'file'
  const filteredCommands = isFile
    ? []
    : builtinCommands.filter(c =>
        c.id.includes(trigger.query)
        || c.description.includes(trigger.query),
      )
  const totalItems = isFile
    ? files.length
    : filteredCommands.length + skills.length
  const emptyText = isFile
    ? hasWorkspace ? '没有匹配的工作区文件' : '未选择工作区'
    : '没有匹配的指令或 Skill'

  const style = {
    bottom: `${Math.max(12, window.innerHeight - anchorRect.top + 8)}px`,
    left: `${anchorRect.left + 8}px`,
    width: `${Math.max(240, anchorRect.width - 16)}px`,
  }

  // Compute an offset for the flat highlightedIndex across commands + skills
  const commandCount = filteredCommands.length

  return createPortal(
    <div
      className="
        fixed z-50 overflow-hidden rounded-xl border bg-popover text-popover-foreground shadow-md
      "
      style={style}
    >
      <Command shouldFilter={false}>
        <CommandList ref={listRef} className="max-h-64">
          {isFile && (
            <CommandGroup heading="@ 选择工作区文件">
              {files.map((file, index) => (
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
            </CommandGroup>
          )}

          {!isFile && filteredCommands.length > 0 && (
            <CommandGroup heading="内置指令">
              {filteredCommands.map((cmd, index) => (
                <CommandItem
                  key={cmd.id}
                  value={cmd.id}
                  className="
                    items-start
                    data-[highlighted=true]:bg-muted
                  "
                  data-highlighted={index === highlightedIndex}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onSelectCommand(cmd)
                  }}
                >
                  <ZapIcon className="mt-0.5 text-amber-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      /
                      {cmd.id}
                      <span className="ml-1.5 text-xs text-muted-foreground">{cmd.title}</span>
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {cmd.description}
                    </span>
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}

          {!isFile && filteredCommands.length > 0 && skills.length > 0 && (
            <CommandSeparator />
          )}

          {!isFile && skills.length > 0 && (
            <CommandGroup heading={filteredCommands.length > 0 ? 'Skills' : '/ 指定 Skill'}>
              {skills.map((skill, index) => {
                const globalIndex = commandCount + index
                return (
                  <CommandItem
                    key={skill.name}
                    value={skill.name}
                    className="
                      items-start
                      data-[highlighted=true]:bg-muted
                    "
                    data-highlighted={globalIndex === highlightedIndex}
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
                )
              })}
            </CommandGroup>
          )}

          {totalItems === 0 && (
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
