import type { AgentMode, BuiltinCommand, ChatFeatures, IMessageContent, ProviderConfigModelSchema, SkillManifest, WorkspaceFileSearchResult } from '@ant-chat/shared'
import type { FileUIPart, LanguageModelUsage } from 'ai'
import { BUILTIN_COMMANDS, calculateContextTokens, classifyFile } from '@ant-chat/shared'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@workspace/ui/components/ai-elements/attachments'
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@workspace/ui/components/ai-elements/prompt-input'
import {
  ContextUsage,
  ContextUsageBody,
  ContextUsageCache,
  ContextUsageContent,
  ContextUsageHeader,
  ContextUsageInput,
  ContextUsageOutput,
  ContextUsageReasoning,
  ContextUsageTrigger,
} from '@workspace/ui/components/context-usage'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { Cable, ChevronDownIcon, FolderOpenIcon, HandIcon, PaperclipIcon, ShieldAlertIcon, ShieldCheckIcon, SquareIcon } from 'lucide-react'
import { nanoid } from 'nanoid'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { providerApi } from '@/api/providerApi'
import { skillApi } from '@/api/skillApi'
import workspaceApi from '@/api/workspaceApi'
import { useChatSettingsContext } from '@/contexts/chatSettings'
import {
  setAgentMode,
  useChatSttingsStore,
} from '@/store/chatSettings'
import {
  activateWorkspace,
  useConversationsStore,
} from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import { useWorkspaceStore } from '@/store/workspace'
import { fileToBase64 } from '@/utils'
import TypingEffect from '../TypingEffect'
import {
  buildReferenceInputParts,
  getActiveReferenceTrigger,
  insertReferenceToken,
  isCompletedReferenceTrigger,
  moveCursorAcrossReferenceToken,
  parentReferenceQuery,
  removeReferenceTokenAtCursor,
  rewriteReferenceTrigger,
  snapCursorToReferenceTokenBoundary,
  syncReferencedFiles,
  syncSelectedSkill,
} from './inputReferences'
import MCPManagementPanel from './MCPManagementPanel'
import { PendingMessageQueue } from './PendingMessageQueue'
import { ReferenceSuggestionPanel } from './ReferenceSuggestionPanel'
import { calculateSessionUsage } from './sessionUsage'

interface SenderProps {
  disabled?: boolean
  actions?: React.ReactNode
  onSubmit?: (
    content: IMessageContent,
    referencedFiles: string[],
    selectedSkill: string | undefined,
    features: ChatFeatures,
    agentMode: AgentMode,
  ) => Promise<boolean | void> | boolean | void
  onCancel?: () => void
  canInjectPendingMessage?: boolean
  onInjectPendingMessage?: (id: string) => void
  onEditPendingMessage?: (id: string, text: string) => void
  onRemovePendingMessage?: (id: string) => void
}

async function filePartToAttachment(part: FileUIPart, index: number) {
  if (!part.url) {
    return null
  }

  const response = await fetch(part.url)
  const blob = await response.blob()
  const filename = part.filename || `attachment-${index}`
  const file = new File([blob], filename, {
    type: part.mediaType || blob.type || 'application/octet-stream',
  })
  const data = await fileToBase64(file)

  return {
    uid: (part as FileUIPart & { id?: string }).id ?? nanoid(),
    name: filename,
    size: file.size,
    type: file.type || 'application/octet-stream',
    data,
  }
}

function SenderAttachmentsPreview() {
  const attachments = usePromptInputAttachments()

  if (!attachments.files.length) {
    return null
  }

  return (
    <Attachments className="mb-2 w-full justify-start px-1 pt-1" variant="inline">
      {attachments.files.map(file => (
        <Attachment
          key={file.id}
          data={{
            id: file.id,
            type: 'file',
            mediaType: file.mediaType,
            filename: file.filename,
            url: file.url,
          }}
          onRemove={() => attachments.remove(file.id)}
        >
          <AttachmentPreview />
          <AttachmentInfo />
          <AttachmentRemove />
        </Attachment>
      ))}
    </Attachments>
  )
}

function SenderAddAttachmentButton({ accept }: { accept: string }) {
  const attachments = usePromptInputAttachments()

  if (!accept) {
    return null
  }

  return (
    <PromptInputButton
      size="icon-xs"
      tooltip="附件(支持文档与图片)"
      onClick={() => attachments.openFileDialog()}
    >
      <PaperclipIcon className="size-4" />
    </PromptInputButton>
  )
}

function SenderContextUsageButton({
  contextLength,
}: {
  contextLength: number
}) {
  const messages = useMessagesStore(state => state.messages)

  // Cumulative token consumption across the whole session
  const sessionUsage = useMemo(
    (): LanguageModelUsage | undefined => calculateSessionUsage(messages),
    [messages],
  )

  // Calculate current context token count using the same logic as compaction
  const usedTokens = useMemo(() => {
    const entries = messages.map(msg => ({
      message: msg,
      usage: msg.usage,
      status: msg.status,
    }))
    return calculateContextTokens(entries)
  }, [messages])

  const hasUsage = sessionUsage !== undefined

  return (
    <ContextUsage
      maxTokens={contextLength}
      usage={sessionUsage}
      usedTokens={Math.max(0, usedTokens)}
    >
      <ContextUsageTrigger
        size="sm"
        type="button"
        variant="ghost"
      />
      <ContextUsageContent align="start" className="w-72">
        <ContextUsageHeader />
        <ContextUsageBody className="space-y-2">
          {hasUsage
            ? (
                <>
                  <ContextUsageInput />
                  <ContextUsageOutput />
                  <ContextUsageReasoning />
                  <ContextUsageCache />
                </>
              )
            : (
                <div className="text-xs text-muted-foreground">暂无用量</div>
              )}
        </ContextUsageBody>
      </ContextUsageContent>
    </ContextUsage>
  )
}

function ReferenceInputOverlay({
  text,
  referencedFiles,
  selectedSkill,
  scrollTop,
}: {
  text: string
  referencedFiles: string[]
  selectedSkill?: string
  scrollTop: number
}) {
  const parts = useMemo(
    () => buildReferenceInputParts(text, referencedFiles, selectedSkill),
    [text, referencedFiles, selectedSkill],
  )

  return (
    <div
      aria-hidden="true"
      className="
        pointer-events-none absolute inset-0 z-0 max-h-48 min-h-24 overflow-hidden p-1 text-left
        text-sm wrap-break-word whitespace-pre-wrap
      "
    >
      <div style={{ transform: `translateY(-${scrollTop}px)` }}>
        {parts.map((part) => {
          if (part.type === 'text') {
            return <span key={`${part.offset}-text`}>{part.text}</span>
          }

          return (
            <span
              key={`${part.offset}-${part.type}-${part.text}`}
              data-testid="reference-token"
              className="rounded-sm bg-primary/10 text-primary ring-2 ring-primary/10"
            >
              {part.text}
            </span>
          )
        })}
      </div>
    </div>
  )
}

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
    | { type: 'RESET_HIGHLIGHTED_INDEX' }
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
    case 'RESET_HIGHLIGHTED_INDEX':
      return { ...state, highlightedIndex: 0 }
    case 'SET_HIGHLIGHTED_INDEX':
      return { ...state, highlightedIndex: action.index }
  }
}

const MODALITY_ACCEPT_MAP: Record<string, string> = {
  text: 'text/*,.md,.csv,.txt,.json',
  image: 'image/*',
  pdf: 'application/pdf',
  video: 'video/*',
  audio: 'audio/*',
}

function buildAcceptFromModalities(inputModalities?: string[]): string {
  if (!inputModalities || inputModalities.length === 0)
    return ''
  return inputModalities
    .map(m => MODALITY_ACCEPT_MAP[m])
    .filter(Boolean)
    .join(',')
}

function Sender({ disabled = false, actions, ...props }: SenderProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const senderRef = useRef<HTMLDivElement | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [draft, setDraft] = useState('')
  const [cursor, setCursor] = useState(0)
  const [referencedFiles, setReferencedFiles] = useState<string[]>([])
  const [selectedSkill, setSelectedSkill] = useState<string>()
  const [textareaScrollTop, setTextareaScrollTop] = useState(0)
  const [currentModelInfo, setCurrentModelInfo] = useState<ProviderConfigModelSchema | null>(null)

  const [senderData, dispatchSenderData] = useReducer(senderDataReducer, {
    skills: [],
    fileResults: [],
    suggestionAnchorRect: null,
    highlightedIndex: 0,
  })

  const workspaceData = useWorkspaceStore(state => state.workspaceData)
  const currentWorkspacePath = useWorkspaceStore(state => state.currentWorkspacePath)
  const refreshWorkspace = useWorkspaceStore(state => state.refresh)
  const openWorkspace = useWorkspaceStore(state => state.openWorkspace)

  const activeConversationsId = useMessagesStore(
    state => state.activeConversationsId,
  )
  const hasMessage = useMessagesStore(state => !!state.messages.length)
  const loading = useConversationsStore(
    state => state.conversationStates[state.activeConversationsId] === 'running',
  )

  const mcpEnabled = useChatSttingsStore(state => state.enableMCP)
  const agentMode = useChatSttingsStore(state => state.agentMode)

  const { settings } = useChatSettingsContext()

  useEffect(() => {
    if (!settings.modelId || !settings.providerId)
      return
    providerApi.getModelInfoById(settings.modelId, settings.providerId).then(setCurrentModelInfo)
  }, [settings.modelId, settings.providerId])

  const fileAccept = useMemo(
    () => buildAcceptFromModalities(currentModelInfo?.capabilities?.inputModalities ?? []),
    [currentModelInfo?.capabilities?.inputModalities],
  )

  const agentModeOptions: Array<{ value: AgentMode, label: string, icon: React.ReactNode }> = [
    { value: 'strict', label: '默认权限', icon: <HandIcon className="size-4" /> },
    { value: 'hybrid', label: '自动审查', icon: <ShieldCheckIcon className="size-4" /> },
    { value: 'full_managed', label: '完全访问权限', icon: <ShieldAlertIcon className="size-4" /> },
  ]
  const currentAgentModeOption = agentModeOptions.find(item => item.value === agentMode) || agentModeOptions[1]
  const activeReferenceTrigger = useMemo(() => {
    const trigger = getActiveReferenceTrigger(draft, cursor)
    return isCompletedReferenceTrigger(trigger, referencedFiles, selectedSkill)
      ? null
      : trigger
  }, [draft, cursor, referencedFiles, selectedSkill])
  const enabledSkills = useMemo(
    () => senderData.skills.filter(skill => skill.enabled),
    [senderData.skills],
  )
  const filteredSkills = useMemo(() => {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'skill') {
      return []
    }
    const query = activeReferenceTrigger.query.toLowerCase()
    return enabledSkills
      .filter(skill =>
        skill.name.toLowerCase().includes(query)
        || (skill.description || '').toLowerCase().includes(query),
      )
      .slice(0, 20)
  }, [activeReferenceTrigger, enabledSkills])

  const filteredCommands = useMemo(() => {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'skill') {
      return []
    }
    const query = activeReferenceTrigger.query.toLowerCase()
    return BUILTIN_COMMANDS.filter(cmd =>
      cmd.id.includes(query)
      || cmd.description.toLowerCase().includes(query),
    )
  }, [activeReferenceTrigger])

  const directoryResults = useMemo(
    () => senderData.fileResults.filter(item => item.type === 'directory'),
    [senderData.fileResults],
  )
  const fileOnlyResults = useMemo(
    () => senderData.fileResults.filter(item => item.type === 'file'),
    [senderData.fileResults],
  )
  // 已钻取到子目录（query 含 `/`）时面板顶部渲染 `..` 返回上级
  const canGoParent = !!activeReferenceTrigger
    && activeReferenceTrigger.type === 'file'
    && activeReferenceTrigger.query.includes('/')

  const suggestionItemCount = activeReferenceTrigger?.type === 'file'
    ? (canGoParent ? 1 : 0) + directoryResults.length + fileOnlyResults.length
    : activeReferenceTrigger?.type === 'skill'
      ? filteredCommands.length + filteredSkills.length
      : 0

  const canSwitchWorkspace = !activeConversationsId && !hasMessage && !loading
  const selectableWorkspaces = useMemo(
    () => (workspaceData?.workspaces || []).filter(item => isAbsoluteWorkspacePath(item.path)),
    [workspaceData],
  )
  const canSwitchWorkspaceSelect = canSwitchWorkspace && selectableWorkspaces.length > 0
  const currentWorkspace = useMemo(
    () =>
      workspaceData?.workspaces.find(
        item => item.path === currentWorkspacePath,
      ),
    [workspaceData, currentWorkspacePath],
  )
  const workspaceDisplayName = currentWorkspace?.displayName || '未选择工作区'
  const workspaceSwitchDisabled = workspaceLoading || !canSwitchWorkspaceSelect

  async function refreshSkills() {
    const data = await skillApi.listSkills()
    dispatchSenderData({ type: 'SET_SKILLS', skills: data.skills })
  }

  useEffect(() => {
    void refreshWorkspace()
    void refreshSkills()
  }, [refreshWorkspace])

  useEffect(() => {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'file') {
      dispatchSenderData({ type: 'CLEAR_FILE_RESULTS' })
      return
    }

    // 没有工作区时不搜索，避免后端抛错并清空已有结果
    if (!currentWorkspacePath) {
      dispatchSenderData({ type: 'CLEAR_FILE_RESULTS' })
      return
    }

    const timer = window.setTimeout(() => {
      void workspaceApi.searchWorkspaceFiles(currentWorkspacePath, activeReferenceTrigger.query, 50)
        .then((results) => {
          dispatchSenderData({ type: 'SET_FILE_RESULTS', results })
        })
        .catch((error) => {
          // 保留错误信息便于排查，同时清空结果避免展示过期数据
          console.error('searchWorkspaceFiles failed', error)
          dispatchSenderData({ type: 'CLEAR_FILE_RESULTS' })
        })
    }, 120)

    return () => window.clearTimeout(timer)
  }, [activeReferenceTrigger, currentWorkspacePath])

  useLayoutEffect(() => {
    if (!activeReferenceTrigger) {
      dispatchSenderData({ type: 'CLEAR_ANCHOR_RECT' })
      return
    }

    const updateRect = () => {
      const anchor = senderRef.current?.querySelector('[data-testid="chat-input-form"]')
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
  }, [activeReferenceTrigger, draft])

  useEffect(() => {
    // 钻取态首项是 `..`，reset 跳过它落到首个目录/文件，符合「继续向下选」的直觉
    const initialIndex = activeReferenceTrigger?.type === 'file' && canGoParent ? 1 : 0
    dispatchSenderData({ type: 'SET_HIGHLIGHTED_INDEX', index: initialIndex })
  }, [activeReferenceTrigger?.type, activeReferenceTrigger?.query, suggestionItemCount, canGoParent])

  async function handleSwitchWorkspace(nextWorkspacePath: string) {
    if (
      !canSwitchWorkspace
      || !workspaceData
      || nextWorkspacePath === currentWorkspacePath
    ) {
      return
    }
    if (!isAbsoluteWorkspacePath(nextWorkspacePath)) {
      return
    }

    setWorkspaceLoading(true)
    setNotice('')
    try {
      await openWorkspace(nextWorkspacePath)
      setWorkspacePickerOpen(false)
      await activateWorkspace(nextWorkspacePath)
    }
    catch (error) {
      setNotice((error as Error).message)
    }
    finally {
      setWorkspaceLoading(false)
    }
  }

  function updateDraft(nextText: string, nextCursor?: number) {
    setDraft(nextText)
    setReferencedFiles(prev => syncReferencedFiles(nextText, prev))
    setSelectedSkill(prev => syncSelectedSkill(nextText, prev))
    if (typeof nextCursor === 'number') {
      setCursor(nextCursor)
    }
  }

  function selectFileReference(file: WorkspaceFileSearchResult) {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'file') {
      return
    }

    const token = `@${file.path}`
    const next = insertReferenceToken(draft, activeReferenceTrigger, token)
    updateDraft(next.text, next.cursor)
    setReferencedFiles(prev => Array.from(new Set([...prev, file.path])))
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  function selectDirectoryReference(dir: WorkspaceFileSearchResult) {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'file') {
      return
    }

    // 把目录路径补到 @ 之后（带尾斜杠），改写 query 触发下一轮搜索
    // 不入 referencedFiles、不关闭面板，由新 query 自然续搜
    const nextQuery = `${dir.path}/`
    const next = rewriteReferenceTrigger(draft, activeReferenceTrigger, nextQuery)
    updateDraft(next.text, next.cursor)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  function selectParentReference() {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'file') {
      return
    }

    const nextQuery = parentReferenceQuery(activeReferenceTrigger.query)
    if (nextQuery === null) {
      return
    }
    const next = rewriteReferenceTrigger(draft, activeReferenceTrigger, nextQuery)
    updateDraft(next.text, next.cursor)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  function selectSkillReference(skill: SkillManifest) {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'skill') {
      return
    }

    const token = `/${skill.name}`
    const next = insertReferenceToken(draft, activeReferenceTrigger, token)
    updateDraft(next.text, next.cursor)
    setSelectedSkill(skill.name)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  function selectCommandReference(command: BuiltinCommand) {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'skill') {
      return
    }

    const token = `/${command.id}`
    const next = insertReferenceToken(draft, activeReferenceTrigger, token)
    updateDraft(next.text, next.cursor)
    // Do NOT set selectedSkill for built-in commands — they go through the command channel
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.cursor, next.cursor)
    })
  }

  function selectHighlightedReference() {
    if (!activeReferenceTrigger || suggestionItemCount === 0) {
      return false
    }

    const index = Math.min(senderData.highlightedIndex, suggestionItemCount - 1)
    if (activeReferenceTrigger.type === 'file') {
      const parentOffset = canGoParent ? 1 : 0
      // 钻取态首项是 `..` 返回上级
      if (canGoParent && index === 0) {
        selectParentReference()
        return true
      }
      // 目录项（钻取入口）
      const dirIndex = index - parentOffset
      if (dirIndex < directoryResults.length) {
        selectDirectoryReference(directoryResults[dirIndex])
        return true
      }
      // 文件项（插入引用 token）
      const fileIndex = dirIndex - directoryResults.length
      selectFileReference(fileOnlyResults[fileIndex])
      return true
    }

    // Commands come first, then skills
    if (index < filteredCommands.length) {
      selectCommandReference(filteredCommands[index])
      return true
    }

    selectSkillReference(filteredSkills[index - filteredCommands.length])
    return true
  }

  function handleTextareaKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
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
        referencedFiles,
        selectedSkill,
      )
      if (nextCursor !== null) {
        event.preventDefault()
        setCursor(nextCursor)
        requestAnimationFrame(() => {
          textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
        })
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
        referencedFiles,
        selectedSkill,
      )
      if (next) {
        event.preventDefault()
        updateDraft(next.text, next.cursor)
        requestAnimationFrame(() => {
          textareaRef.current?.focus()
          textareaRef.current?.setSelectionRange(next.cursor, next.cursor)
        })
        return
      }
    }

    if (!activeReferenceTrigger) {
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      setCursor(0)
      return
    }

    if (event.key === 'ArrowDown' && suggestionItemCount > 0) {
      event.preventDefault()
      dispatchSenderData({ type: 'SET_HIGHLIGHTED_INDEX', index: (senderData.highlightedIndex + 1) % suggestionItemCount })
      return
    }

    if (event.key === 'ArrowUp' && suggestionItemCount > 0) {
      event.preventDefault()
      dispatchSenderData({ type: 'SET_HIGHLIGHTED_INDEX', index: (senderData.highlightedIndex - 1 + suggestionItemCount) % suggestionItemCount })
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

  function updateCursorFromTextarea(element: HTMLTextAreaElement) {
    const nextCursor = snapCursorToReferenceTokenBoundary(
      draft,
      element.selectionStart,
      referencedFiles,
      selectedSkill,
    )
    setCursor(nextCursor)
    if (nextCursor !== element.selectionStart) {
      requestAnimationFrame(() => {
        textareaRef.current?.setSelectionRange(nextCursor, nextCursor)
      })
    }
  }

  function handleTextareaKeyUp(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (['ArrowDown', 'ArrowUp', 'Enter', 'Escape', 'Tab'].includes(event.key)) {
      return
    }

    updateCursorFromTextarea(event.currentTarget)
  }

  async function handleSubmit(message: { text: string, files: FileUIPart[] }) {
    const nextReferencedFiles = syncReferencedFiles(message.text, referencedFiles)
    const nextSelectedSkill = syncSelectedSkill(message.text, selectedSkill)

    const files = await Promise.all(
      message.files.map((part, index) => filePartToAttachment(part, index)),
    )

    // 构建 content blocks
    const content: IMessageContent = [
      { type: 'text', text: message.text },
    ]

    // 添加文件 content blocks
    files.forEach((file) => {
      if (!file) {
        return
      }

      const category = classifyFile(file.name, file.type)

      if (category === 'image') {
        content.push({
          type: 'image-block',
          source: {
            type: 'file_id',
            file_id: file.uid,
          },
          name: file.name,
          media_type: file.type,
          size: file.size,
          data: file.data,
        })
      }
      else if (category === 'document') {
        content.push({
          type: 'document',
          source: {
            type: 'file_id',
            file_id: file.uid,
          },
          name: file.name,
          media_type: file.type,
          size: file.size,
          data: file.data,
        })
      }
      else {
        content.push({
          type: 'file',
          source: {
            type: 'file_id',
            file_id: file.uid,
          },
          filename: file.name,
          name: file.name,
          media_type: file.type,
          size: file.size,
          data: file.data,
        })
      }
    })

    const submitted = await props.onSubmit?.(content, nextReferencedFiles, nextSelectedSkill, {
      enableMCP: mcpEnabled,
    }, agentMode)
    if (submitted === false)
      return
    setDraft('')
    setCursor(0)
    setReferencedFiles([])
    setSelectedSkill(undefined)
    setTextareaScrollTop(0)
    // 恢复 textarea 焦点，防止因外部状态变化导致其失焦
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }

  return (
    <div
      ref={senderRef}
      className="mx-auto w-full max-w-(--chat-width)"
    >
      {!hasMessage && (
        <h1 className="mb-3 py-3 text-center text-2xl text-balance text-muted-foreground md:text-4xl">
          <TypingEffect text="有什么可以帮忙的？" />
        </h1>
      )}
      <div className="overflow-hidden rounded-lg bg-secondary">

        <PendingMessageQueue
          conversationId={activeConversationsId}
          canInject={props.canInjectPendingMessage ?? false}
          onInject={id => props.onInjectPendingMessage?.(id)}
          onEdit={(id, text) => props.onEditPendingMessage?.(id, text)}
          onRemove={id => props.onRemovePendingMessage?.(id)}
        />

        <PromptInput
          accept={fileAccept}
          className="overflow-hidden rounded-lg bg-background"
          data-testid="chat-input-form"
          maxFileSize={20 * 1024 * 1024}
          multiple
          onError={({ message }) => setNotice(message)}
          onSubmit={async (message) => {
            setNotice('')
            await handleSubmit(message)
          }}
        >
          <PromptInputBody className="bg-transparent px-1 pt-1">
            <SenderAttachmentsPreview />
            <div className="relative min-h-20 w-full md:min-h-24">
              <ReferenceInputOverlay
                text={draft}
                referencedFiles={referencedFiles}
                selectedSkill={selectedSkill}
                scrollTop={textareaScrollTop}
              />
              <PromptInputTextarea
                ref={textareaRef}
                className="
                relative z-10 max-h-48 min-h-20 border-0 bg-transparent p-1 text-sm
                text-transparent caret-foreground
                selection:bg-primary/20 selection:text-foreground
                placeholder:text-muted-foreground
                md:min-h-24
              "
                data-testid="chat-input"
                disabled={disabled}
                value={draft}
                onChange={(event) => {
                  updateDraft(event.currentTarget.value, event.currentTarget.selectionStart)
                }}
                onClick={event => updateCursorFromTextarea(event.currentTarget)}
                onKeyDown={handleTextareaKeyDown}
                onKeyUp={handleTextareaKeyUp}
                onScroll={event => setTextareaScrollTop(event.currentTarget.scrollTop)}
                placeholder={disabled
                  ? '指令执行中...'
                  : loading
                    ? '输入追加指令，Enter发送'
                    : 'Enter发送消息，Shift+Enter换行'}
              />
            </div>
            <ReferenceSuggestionPanel
              trigger={activeReferenceTrigger}
              directories={directoryResults}
              files={fileOnlyResults}
              skills={filteredSkills}
              builtinCommands={filteredCommands}
              hasWorkspace={Boolean(currentWorkspacePath)}
              canGoParent={canGoParent}
              highlightedIndex={senderData.highlightedIndex}
              anchorRect={senderData.suggestionAnchorRect}
              onSelectFile={selectFileReference}
              onSelectDirectory={selectDirectoryReference}
              onSelectParent={selectParentReference}
              onSelectSkill={selectSkillReference}
              onSelectCommand={selectCommandReference}
              onSetHighlightedIndex={index => dispatchSenderData({ type: 'SET_HIGHLIGHTED_INDEX', index })}
            />
          </PromptInputBody>

          <PromptInputFooter className="min-w-0">
            <PromptInputTools className="scroll-hidden overflow-visible max-sm:overflow-x-auto">
              <Popover
                open={canSwitchWorkspaceSelect ? workspacePickerOpen : false}
                onOpenChange={(next) => {
                  if (canSwitchWorkspaceSelect) {
                    setWorkspacePickerOpen(next)
                  }
                }}
              >
                <PopoverTrigger render={(
                  <PromptInputButton
                    type="button"
                    variant="ghost"
                    data-testid="workspace-switcher"
                    disabled={workspaceLoading}
                    aria-disabled={workspaceSwitchDisabled}
                    aria-label={`工作区：${workspaceDisplayName}`}
                    className={`
                    h-8 max-w-52 justify-start border px-2
                    max-sm:size-8 max-sm:justify-center max-sm:gap-0 max-sm:px-0
                    ${workspaceSwitchDisabled
                    ? `
        pointer-events-none opacity-100
        hover:bg-transparent
      `
                    : ''}
                  `}
                  >
                    <FolderOpenIcon className="size-4 shrink-0" />
                    <span className="truncate text-xs max-sm:hidden">{workspaceDisplayName}</span>
                  </PromptInputButton>
                )}
                />
                <PopoverContent align="start" className="w-64 p-1">
                  <div className="max-h-60 overflow-y-auto">
                    {selectableWorkspaces.map(item => (
                      <button
                        key={item.path}
                        type="button"
                        className={`
                        flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm
                        hover:bg-accent hover:text-accent-foreground
                      `}
                        onClick={() => {
                          void handleSwitchWorkspace(item.path)
                        }}
                      >
                        <FolderOpenIcon className="size-4 shrink-0" />
                        <span className="truncate">{item.displayName}</span>
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>

              <SenderAddAttachmentButton accept={fileAccept} />
              <SenderContextUsageButton contextLength={currentModelInfo?.contextLength ?? 1} />

              <Popover>
                <PopoverTrigger render={(
                  <PromptInputButton
                    size="sm"
                    type="button"
                    variant="ghost"
                    aria-label={`权限模式：${currentAgentModeOption.label}`}
                    className={`
                    ${agentMode === 'full_managed' ? 'text-orange-600' : ''}
                  `}
                  >
                    {currentAgentModeOption.icon}
                    <span className="max-sm:hidden">{currentAgentModeOption.label}</span>
                    <ChevronDownIcon className="size-3 max-sm:hidden" />
                  </PromptInputButton>
                )}
                />
                <PopoverContent align="start" className="w-52 p-1">
                  {agentModeOptions.map(item => (
                    <button
                      key={item.value}
                      type="button"
                      className={`
                      flex h-9 w-full items-center justify-between rounded-md px-2 text-sm
                      hover:bg-accent hover:text-accent-foreground
                    `}
                      onClick={() => setAgentMode(item.value)}
                    >
                      <span className="flex items-center gap-2">
                        {item.icon}
                        {item.label}
                      </span>
                      {item.value === agentMode ? <span>✓</span> : null}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>

              <Popover>
                <PopoverTrigger render={(
                  <PromptInputButton
                    size="sm"
                    type="button"
                    variant={mcpEnabled ? 'secondary' : 'ghost'}
                    aria-label="MCP 管理"
                  >
                    <Cable className="size-3" />
                    <span className="max-sm:hidden">MCP</span>
                  </PromptInputButton>
                )}
                />
                <PopoverContent align="start" className="w-[calc(100vw-1rem)] max-w-85 p-0">
                  <MCPManagementPanel />
                </PopoverContent>
              </Popover>

              {actions}
            </PromptInputTools>

            {loading
              ? (
                  <div className="min-w-17">
                    {draft.trim()
                      ? (
                          <PromptInputSubmit className="sender-primary-action" size="sm" data-testid="chat-submit" status="ready">
                            发送
                          </PromptInputSubmit>
                        )
                      : (
                          <PromptInputButton className="sender-primary-action" size="sm" type="button" variant="outline" data-testid="chat-cancel" onClick={props.onCancel}>
                            <SquareIcon className="size-3" />
                            停止
                          </PromptInputButton>
                        )}
                  </div>
                )
              : (
                  <PromptInputSubmit
                    size="sm"
                    data-testid={disabled ? 'chat-cancel' : 'chat-submit'}
                    onStop={props.onCancel}
                    status={disabled ? 'submitted' : 'ready'}
                  >
                    {disabled ? '执行中' : '发送'}
                  </PromptInputSubmit>
                )}
          </PromptInputFooter>
        </PromptInput>

      </div>

      {notice && (
        <div className="mt-2 text-xs text-red-500">{notice}</div>
      )}

    </div>
  )
}

function isAbsoluteWorkspacePath(workspacePath: string): boolean {
  return workspacePath.startsWith('/')
    || /^[a-z]:[\\/]/i.test(workspacePath)
    || workspacePath.startsWith('\\\\')
}

export default Sender
