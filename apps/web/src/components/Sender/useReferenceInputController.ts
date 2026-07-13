import type { BuiltinCommand, SkillManifest, WorkspaceFileSearchResult } from '@ant-chat/shared'
import type { ChangeEvent, KeyboardEvent, RefObject } from 'react'
import type { ActiveReferenceTrigger } from './inputReferences'
import { BUILTIN_COMMANDS } from '@ant-chat/shared'
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import { skillApi } from '@/api/skillApi'
import workspaceApi from '@/api/workspaceApi'
import {
  getActiveReferenceTrigger,
  insertReferenceToken,
  isCompletedReferenceTrigger,
  moveCursorAcrossReferenceToken,
  parentReferenceQuery,
  removeReferenceTokenAtCursor,
  rewriteReferenceTrigger,
  snapCursorToReferenceTokenBoundary,
  syncConfirmedFileReferences,
  syncConfirmedSkillReference,
} from './inputReferences'

interface SenderDataState {
  skills: SkillManifest[]
  fileResults: WorkspaceFileSearchResult[]
  suggestionAnchorRect: DOMRect | null
  highlightedIndex: number
}

type SenderDataAction
  = | { type: 'SET_SKILLS', skills: SkillManifest[] }
    | { type: 'CLEAR_FILE_RESULTS' }
    | { type: 'SET_FILE_RESULTS', results: WorkspaceFileSearchResult[] }
    | { type: 'CLEAR_ANCHOR_RECT' }
    | { type: 'SET_ANCHOR_RECT', rect: DOMRect | null }
    | { type: 'SET_HIGHLIGHTED_INDEX', index: number }

function senderDataReducer(state: SenderDataState, action: SenderDataAction): SenderDataState {
  switch (action.type) {
    case 'SET_SKILLS':
      return { ...state, skills: action.skills }
    case 'CLEAR_FILE_RESULTS':
      return { ...state, fileResults: [] }
    case 'SET_FILE_RESULTS':
      return { ...state, fileResults: action.results }
    case 'CLEAR_ANCHOR_RECT':
      return { ...state, suggestionAnchorRect: null }
    case 'SET_ANCHOR_RECT':
      return { ...state, suggestionAnchorRect: action.rect }
    case 'SET_HIGHLIGHTED_INDEX':
      return { ...state, highlightedIndex: action.index }
  }
}

export interface ReferenceInputController {
  textareaRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  scrollTop: number
  confirmedFileReferences: string[]
  confirmedSkillReference?: string
  trigger: ActiveReferenceTrigger | null
  directories: WorkspaceFileSearchResult[]
  files: WorkspaceFileSearchResult[]
  skills: SkillManifest[]
  builtinCommands: BuiltinCommand[]
  hasWorkspace: boolean
  canGoParent: boolean
  highlightedIndex: number
  anchorRect: DOMRect | null
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onClick: (event: React.MouseEvent<HTMLTextAreaElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onKeyUp: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onScroll: (event: React.UIEvent<HTMLTextAreaElement>) => void
  onSelectFile: (file: WorkspaceFileSearchResult) => void
  onSelectDirectory: (directory: WorkspaceFileSearchResult) => void
  onSelectParent: () => void
  onSelectSkill: (skill: SkillManifest) => void
  onSelectCommand: (command: BuiltinCommand) => void
  onSetHighlightedIndex: (index: number) => void
  reset: () => void
}

interface UseReferenceInputControllerOptions {
  containerRef: RefObject<HTMLDivElement | null>
  workspacePath: string
}

export function useReferenceInputController({
  containerRef,
  workspacePath,
}: UseReferenceInputControllerOptions): ReferenceInputController {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [draft, setDraft] = useState('')
  const [cursor, setCursor] = useState(0)
  const [confirmedFileReferences, setConfirmedFileReferences] = useState<string[]>([])
  const [confirmedSkillReference, setConfirmedSkillReference] = useState<string>()
  const [scrollTop, setScrollTop] = useState(0)
  const [senderData, dispatchSenderData] = useReducer(senderDataReducer, {
    skills: [],
    fileResults: [],
    suggestionAnchorRect: null,
    highlightedIndex: 0,
  })

  const trigger = useMemo(() => {
    const activeTrigger = getActiveReferenceTrigger(draft, cursor)
    return isCompletedReferenceTrigger(activeTrigger, confirmedFileReferences, confirmedSkillReference)
      ? null
      : activeTrigger
  }, [draft, cursor, confirmedFileReferences, confirmedSkillReference])

  const enabledSkills = useMemo(
    () => senderData.skills.filter(skill => skill.enabled),
    [senderData.skills],
  )
  const skills = useMemo(() => {
    if (!trigger || trigger.type !== 'skill') {
      return []
    }
    const query = trigger.query.toLowerCase()
    return enabledSkills
      .filter(skill =>
        skill.name.toLowerCase().includes(query)
        || (skill.description || '').toLowerCase().includes(query),
      )
      .slice(0, 20)
  }, [trigger, enabledSkills])
  const builtinCommands = useMemo(() => {
    if (!trigger || trigger.type !== 'skill') {
      return []
    }
    const query = trigger.query.toLowerCase()
    return BUILTIN_COMMANDS.filter(command =>
      command.id.includes(query)
      || command.description.toLowerCase().includes(query),
    )
  }, [trigger])

  const directories = useMemo(
    () => senderData.fileResults.filter(item => item.type === 'directory'),
    [senderData.fileResults],
  )
  const files = useMemo(
    () => senderData.fileResults.filter(item => item.type === 'file'),
    [senderData.fileResults],
  )
  const canGoParent = !!trigger && trigger.type === 'file' && trigger.query.includes('/')
  const suggestionItemCount = trigger?.type === 'file'
    ? (canGoParent ? 1 : 0) + directories.length + files.length
    : trigger?.type === 'skill'
      ? builtinCommands.length + skills.length
      : 0

  useEffect(() => {
    void skillApi.listSkills().then((data) => {
      dispatchSenderData({ type: 'SET_SKILLS', skills: data.skills })
    })
  }, [])

  useEffect(() => {
    if (!trigger || trigger.type !== 'file' || !workspacePath) {
      dispatchSenderData({ type: 'CLEAR_FILE_RESULTS' })
      return
    }

    const timer = window.setTimeout(() => {
      void workspaceApi.searchWorkspaceFiles(workspacePath, trigger.query, 50)
        .then((results) => {
          dispatchSenderData({ type: 'SET_FILE_RESULTS', results })
        })
        .catch((error) => {
          console.error('searchWorkspaceFiles failed', error)
          dispatchSenderData({ type: 'CLEAR_FILE_RESULTS' })
        })
    }, 120)

    return () => window.clearTimeout(timer)
  }, [trigger, workspacePath])

  useLayoutEffect(() => {
    if (!trigger) {
      dispatchSenderData({ type: 'CLEAR_ANCHOR_RECT' })
      return
    }

    const updateRect = () => {
      const anchor = containerRef.current?.querySelector('[data-testid="chat-input-form"]')
      const rect = anchor?.getBoundingClientRect()
      dispatchSenderData({ type: 'SET_ANCHOR_RECT', rect: rect ?? null })
    }

    updateRect()
    window.addEventListener('resize', updateRect)
    window.addEventListener('scroll', updateRect, true)

    return () => {
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect, true)
    }
  }, [containerRef, trigger, draft])

  useEffect(() => {
    const initialIndex = trigger?.type === 'file' && canGoParent ? 1 : 0
    dispatchSenderData({ type: 'SET_HIGHLIGHTED_INDEX', index: initialIndex })
  }, [trigger?.type, trigger?.query, suggestionItemCount, canGoParent])

  function updateDraft(nextText: string, nextCursor?: number) {
    setDraft(nextText)
    setConfirmedFileReferences(previous => syncConfirmedFileReferences(nextText, previous))
    setConfirmedSkillReference(previous => syncConfirmedSkillReference(nextText, previous))
    if (typeof nextCursor === 'number') {
      setCursor(nextCursor)
    }
  }

  function focusTextarea(nextCursor: number) {
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function selectFile(file: WorkspaceFileSearchResult) {
    if (!trigger || trigger.type !== 'file') {
      return
    }

    const next = insertReferenceToken(draft, trigger, `@${file.path}`)
    updateDraft(next.text, next.cursor)
    setConfirmedFileReferences(previous => Array.from(new Set([...previous, file.path])))
    focusTextarea(next.cursor)
  }

  function selectDirectory(directory: WorkspaceFileSearchResult) {
    if (!trigger || trigger.type !== 'file') {
      return
    }

    const next = rewriteReferenceTrigger(draft, trigger, `${directory.path}/`)
    updateDraft(next.text, next.cursor)
    focusTextarea(next.cursor)
  }

  function selectParent() {
    if (!trigger || trigger.type !== 'file') {
      return
    }

    const nextQuery = parentReferenceQuery(trigger.query)
    if (nextQuery === null) {
      return
    }
    const next = rewriteReferenceTrigger(draft, trigger, nextQuery)
    updateDraft(next.text, next.cursor)
    focusTextarea(next.cursor)
  }

  function selectSkill(skill: SkillManifest) {
    if (!trigger || trigger.type !== 'skill') {
      return
    }

    const next = insertReferenceToken(draft, trigger, `/${skill.name}`)
    updateDraft(next.text, next.cursor)
    setConfirmedSkillReference(skill.name)
    focusTextarea(next.cursor)
  }

  function selectCommand(command: BuiltinCommand) {
    if (!trigger || trigger.type !== 'skill') {
      return
    }

    const next = insertReferenceToken(draft, trigger, `/${command.id}`)
    updateDraft(next.text, next.cursor)
    focusTextarea(next.cursor)
  }

  function selectHighlightedReference() {
    if (!trigger || suggestionItemCount === 0) {
      return false
    }

    const index = Math.min(senderData.highlightedIndex, suggestionItemCount - 1)
    if (trigger.type === 'file') {
      const parentOffset = canGoParent ? 1 : 0
      if (canGoParent && index === 0) {
        selectParent()
        return true
      }

      const directoryIndex = index - parentOffset
      if (directoryIndex < directories.length) {
        selectDirectory(directories[directoryIndex])
        return true
      }

      const fileIndex = directoryIndex - directories.length
      selectFile(files[fileIndex])
      return true
    }

    if (index < builtinCommands.length) {
      selectCommand(builtinCommands[index])
      return true
    }

    selectSkill(skills[index - builtinCommands.length])
    return true
  }

  function updateCursorFromTextarea(element: HTMLTextAreaElement) {
    const nextCursor = snapCursorToReferenceTokenBoundary(
      draft,
      element.selectionStart,
      confirmedFileReferences,
      confirmedSkillReference,
    )
    setCursor(nextCursor)
    if (nextCursor !== element.selectionStart) {
      focusTextarea(nextCursor)
    }
  }

  function onChange(event: ChangeEvent<HTMLTextAreaElement>) {
    updateDraft(event.currentTarget.value, event.currentTarget.selectionStart)
  }

  function onClick(event: React.MouseEvent<HTMLTextAreaElement>) {
    updateCursorFromTextarea(event.currentTarget)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      && !event.shiftKey
      && !event.altKey
      && !event.metaKey
      && !event.ctrlKey
      && event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const nextCursor = moveCursorAcrossReferenceToken(
        draft,
        event.currentTarget.selectionStart,
        event.key,
        confirmedFileReferences,
        confirmedSkillReference,
      )
      if (nextCursor !== null) {
        event.preventDefault()
        setCursor(nextCursor)
        focusTextarea(nextCursor)
        return
      }
    }

    if (
      (event.key === 'Backspace' || event.key === 'Delete')
      && event.currentTarget.selectionStart === event.currentTarget.selectionEnd
    ) {
      const next = removeReferenceTokenAtCursor(
        draft,
        event.currentTarget.selectionStart,
        event.key,
        confirmedFileReferences,
        confirmedSkillReference,
      )
      if (next) {
        event.preventDefault()
        updateDraft(next.text, next.cursor)
        focusTextarea(next.cursor)
        return
      }
    }

    if (!trigger) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setCursor(0)
      return
    }

    if (event.key === 'ArrowDown' && suggestionItemCount > 0) {
      event.preventDefault()
      dispatchSenderData({
        type: 'SET_HIGHLIGHTED_INDEX',
        index: (senderData.highlightedIndex + 1) % suggestionItemCount,
      })
      return
    }

    if (event.key === 'ArrowUp' && suggestionItemCount > 0) {
      event.preventDefault()
      dispatchSenderData({
        type: 'SET_HIGHLIGHTED_INDEX',
        index: (senderData.highlightedIndex - 1 + suggestionItemCount) % suggestionItemCount,
      })
      return
    }

    if (event.key === 'Enter' && !event.shiftKey && suggestionItemCount > 0) {
      event.preventDefault()
      selectHighlightedReference()
    }

    if (event.key === 'Tab' && suggestionItemCount > 0) {
      event.preventDefault()
      selectHighlightedReference()
    }
  }

  function onKeyUp(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
      return
    }

    updateCursorFromTextarea(event.currentTarget)
  }

  function onScroll(event: React.UIEvent<HTMLTextAreaElement>) {
    setScrollTop(event.currentTarget.scrollTop)
  }

  function reset() {
    setDraft('')
    setCursor(0)
    setConfirmedFileReferences([])
    setConfirmedSkillReference(undefined)
    setScrollTop(0)
  }

  return {
    textareaRef,
    draft,
    scrollTop,
    confirmedFileReferences,
    confirmedSkillReference,
    trigger,
    directories,
    files,
    skills,
    builtinCommands,
    hasWorkspace: Boolean(workspacePath),
    canGoParent,
    highlightedIndex: senderData.highlightedIndex,
    anchorRect: senderData.suggestionAnchorRect,
    onChange,
    onClick,
    onKeyDown,
    onKeyUp,
    onScroll,
    onSelectFile: selectFile,
    onSelectDirectory: selectDirectory,
    onSelectParent: selectParent,
    onSelectSkill: selectSkill,
    onSelectCommand: selectCommand,
    onSetHighlightedIndex: index => dispatchSenderData({ type: 'SET_HIGHLIGHTED_INDEX', index }),
    reset,
  }
}
