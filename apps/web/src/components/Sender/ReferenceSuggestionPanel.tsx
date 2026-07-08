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
import { FileIcon, FolderIcon, SparklesIcon, ZapIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

interface ReferenceSuggestionPanelProps {
  trigger: ActiveReferenceTrigger | null
  /** type === 'directory' 的结果项，作为路径钻取入口 */
  directories: WorkspaceFileSearchResult[]
  /** type === 'file' 的结果项 */
  files: WorkspaceFileSearchResult[]
  skills: SkillManifest[]
  builtinCommands: BuiltinCommand[]
  hasWorkspace: boolean
  /** 是否已钻取到子目录（query 含 `/`），为 true 时面板顶部渲染 `..` 返回上级 */
  canGoParent: boolean
  highlightedIndex: number
  anchorRect: DOMRect | null
  onSelectFile: (file: WorkspaceFileSearchResult) => void
  onSelectDirectory: (dir: WorkspaceFileSearchResult) => void
  onSelectParent: () => void
  onSelectSkill: (skill: SkillManifest) => void
  onSelectCommand: (command: BuiltinCommand) => void
  /** 鼠标悬停时同步键盘高亮索引，避免同时出现两个选择状态 */
  onSetHighlightedIndex: (index: number) => void
}

/**
 * 计算目录项的显示名：相对当前 query 的剩余部分，更清爽。
 *
 * - `src/components` + query `src/`    -> `components`
 * - `src/components` + query `src/co`  -> `components`
 * - `src`           + query ``         -> `src`
 */
function computeDirectoryLabel(dirPath: string, query: string): string {
  const slashIdx = query.lastIndexOf('/')
  const dirPrefix = slashIdx >= 0 ? query.slice(0, slashIdx + 1) : ''
  const label = dirPrefix ? dirPath.slice(dirPrefix.length) : dirPath
  return label || dirPath
}

export function ReferenceSuggestionPanel({
  trigger,
  directories,
  files,
  skills,
  builtinCommands,
  hasWorkspace,
  canGoParent,
  highlightedIndex,
  anchorRect,
  onSelectFile,
  onSelectDirectory,
  onSelectParent,
  onSelectSkill,
  onSelectCommand,
  onSetHighlightedIndex,
}: ReferenceSuggestionPanelProps) {
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const activeItem = listRef.current?.querySelector('[data-highlighted="true"]')
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [highlightedIndex, files, directories, skills, builtinCommands, canGoParent])

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
  // file 模式：.. (可选) + 目录 + 文件；skill 模式：commands + skills
  const parentOffset = isFile && canGoParent ? 1 : 0
  // 实际可选项数量（不含 .. 返回上级项），用于判断是否需要空状态提示
  const fileContentCount = isFile ? directories.length + files.length : 0
  const totalItems = isFile
    ? parentOffset + fileContentCount
    : filteredCommands.length + skills.length
  // 钻取态下目录与文件都为空时，给出明确提示而非只剩一个孤零零的 ..
  const emptyText = isFile
    ? canGoParent
      ? '此目录下没有可引用的文件'
      : (hasWorkspace ? '没有匹配的工作区文件' : '未选择工作区')
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
              {/* 1. 返回上级（仅钻取态显示，点击不关闭面板） */}
              {canGoParent && (
                <CommandItem
                  key="__parent__"
                  value=".."
                  className="data-[highlighted=true]:bg-muted data-[selected=true]:bg-transparent data-[selected=true]:text-inherit"
                  data-highlighted={highlightedIndex === 0}
                  onMouseEnter={() => onSetHighlightedIndex(0)}
                  onMouseDown={(event) => {
                    event.preventDefault()
                    onSelectParent()
                  }}
                >
                  <FolderIcon className="text-muted-foreground" />
                  <span className="truncate text-muted-foreground">..</span>
                </CommandItem>
              )}

              {/* 2. 钻取态空目录提示：目录与文件都为空时，给出明确反馈而非只剩孤零零的 .. */}
              {canGoParent && fileContentCount === 0 && (
                <div
                  className="
                    px-3 py-2 text-sm text-muted-foreground
                  "
                >
                  {emptyText}
                </div>
              )}

              {/* 3. 目录项（点击钻取，不关闭面板） */}
              {directories.map((dir, index) => {
                const globalIndex = parentOffset + index
                const label = computeDirectoryLabel(dir.path, trigger.query)
                return (
                  <CommandItem
                    key={dir.path}
                    value={dir.path}
                    className="data-[highlighted=true]:bg-muted data-[selected=true]:bg-transparent! data-[selected=true]:text-inherit!"
                    data-highlighted={globalIndex === highlightedIndex}
                    onMouseEnter={() => onSetHighlightedIndex(globalIndex)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      onSelectDirectory(dir)
                    }}
                  >
                    <FolderIcon className="text-muted-foreground" />
                    <span className="truncate">{label}</span>
                  </CommandItem>
                )
              })}

              {/* 4. 文件项（点击插入引用 token，关闭面板） */}
              {files.map((file, index) => {
                const globalIndex = parentOffset + directories.length + index
                return (
                  <CommandItem
                    key={file.path}
                    value={file.path}
                    className="data-[highlighted=true]:bg-muted data-[selected=true]:bg-transparent data-[selected=true]:text-inherit"
                    data-highlighted={globalIndex === highlightedIndex}
                    onMouseEnter={() => onSetHighlightedIndex(globalIndex)}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      onSelectFile(file)
                    }}
                  >
                    <FileIcon className="text-muted-foreground" />
                    <span className="truncate">{file.path}</span>
                  </CommandItem>
                )
              })}
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
                    data-[selected=true]:bg-transparent
                    data-[selected=true]:text-inherit
                  "
                  data-highlighted={index === highlightedIndex}
                  onMouseEnter={() => onSetHighlightedIndex(index)}
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
                      data-[selected=true]:bg-transparent
                      data-[selected=true]:text-inherit
                    "
                    data-highlighted={globalIndex === highlightedIndex}
                    onMouseEnter={() => onSetHighlightedIndex(globalIndex)}
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
