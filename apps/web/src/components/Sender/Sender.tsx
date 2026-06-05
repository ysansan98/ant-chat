import type { AgentMode, BuiltinCommand, ChatFeatures, IMessageContent, ProviderConfigModelSchema, SkillManifest, WorkspaceFileSearchResult } from '@ant-chat/shared'
import type { FileUIPart, LanguageModelUsage } from 'ai'
import { BUILTIN_COMMANDS, classifyFile } from '@ant-chat/shared'
import {
  Attachment,
  AttachmentInfo,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
} from '@workspace/ui/components/ai-elements/attachments'
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextReasoningUsage,
  ContextTrigger,
} from '@workspace/ui/components/ai-elements/context'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { Cable, ChevronDownIcon, FolderOpenIcon, HandIcon, PaperclipIcon, ShieldAlertIcon, ShieldCheckIcon } from 'lucide-react'
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
  switchWorkspaceConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { fileToBase64 } from '@/utils'
import TypingEffect from '../TypingEffect'
import {
  buildReferenceInputParts,
  getActiveReferenceTrigger,
  insertReferenceToken,
  isCompletedReferenceTrigger,
  moveCursorAcrossReferenceToken,
  removeReferenceTokenAtCursor,
  snapCursorToReferenceTokenBoundary,
  syncReferencedFiles,
  syncSelectedSkill,
} from './inputReferences'
import MCPManagementPanel from './MCPManagementPanel'
import { ReferenceSuggestionPanel } from './ReferenceSuggestionPanel'

interface SenderProps {
  disabled?: boolean
  actions?: React.ReactNode
  onSubmit?: (
    content: IMessageContent,
    referencedFiles: string[],
    selectedSkill: string | undefined,
    features: ChatFeatures,
    agentMode: AgentMode,
  ) => void
  onCancel?: () => void
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

function SenderAddAttachmentButton() {
  const attachments = usePromptInputAttachments()

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

function SenderContextUsageButton() {
  const { settings } = useChatSettingsContext()
  const messages = useMessagesStore(state => state.messages)

  const latestAssistantMessage = [...messages]
    .reverse()
    .find(msg => msg.role === 'assistant')

  const usage = latestAssistantMessage?.usage
  const contextUsage: LanguageModelUsage | undefined = usage
    ? {
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens,
        reasoningTokens: usage.reasoningTokens,
        cachedInputTokens: usage.cachedInputTokens,
        inputTokenDetails: {
          noCacheTokens: undefined,
          cacheReadTokens: undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          reasoningTokens: undefined,
          textTokens: undefined,
        },
      }
    : undefined
  const maxTokens = settings.maxTokens || 1
  const usedTokens = contextUsage?.totalTokens
    ?? ((contextUsage?.inputTokens || 0) + (contextUsage?.outputTokens || 0))

  return (
    <Context
      maxTokens={maxTokens}
      modelId={settings.modelId || undefined}
      usage={contextUsage}
      usedTokens={Math.max(0, usedTokens)}
    >
      <ContextTrigger
        size="sm"
        type="button"
        variant="ghost"
      />
      <ContextContent align="start" className="w-72">
        <ContextContentHeader />
        <ContextContentBody className="space-y-2">
          {contextUsage
            ? (
                <>
                  <ContextInputUsage />
                  <ContextOutputUsage />
                  <ContextReasoningUsage />
                  <ContextCacheUsage />
                </>
              )
            : (
                <div className="text-xs text-gray-500">No usage yet</div>
              )}
        </ContextContentBody>
        <ContextContentFooter />
      </ContextContent>
    </Context>
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
        text-base wrap-break-word whitespace-pre-wrap
        md:text-sm
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

type WorkspaceDataType = Awaited<ReturnType<typeof workspaceApi.listWorkspaces>> | null

interface SenderDataState {
  workspaceData: WorkspaceDataType
  skills: SkillManifest[]
  fileResults: WorkspaceFileSearchResult[]
  suggestionAnchorRect: DOMRect | null
  highlightedIndex: number
}

type SenderDataAction
  = | { type: 'SET_WORKSPACE_DATA', data: WorkspaceDataType }
    | { type: 'SYNC_WORKSPACE_PATH', currentWorkspacePath: string }
    | { type: 'SET_SKILLS', skills: SkillManifest[] }
    | { type: 'CLEAR_FILE_RESULTS' }
    | { type: 'SET_FILE_RESULTS', results: WorkspaceFileSearchResult[] }
    | { type: 'CLEAR_ANCHOR_RECT' }
    | { type: 'SET_ANCHOR_RECT', rect: DOMRect | null }
    | { type: 'RESET_HIGHLIGHTED_INDEX' }
    | { type: 'SET_HIGHLIGHTED_INDEX', index: number }

function senderDataReducer(state: SenderDataState, action: SenderDataAction): SenderDataState {
  switch (action.type) {
    case 'SET_WORKSPACE_DATA':
      return { ...state, workspaceData: action.data }
    case 'SYNC_WORKSPACE_PATH': {
      const prev = state.workspaceData
      if (!prev || prev.currentWorkspacePath === action.currentWorkspacePath)
        return state
      return { ...state, workspaceData: { ...prev, currentWorkspacePath: action.currentWorkspacePath } }
    }
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

const DEFAULT_ACCEPT = 'image/*'

function buildAcceptFromModalities(inputModalities?: string[]): string {
  if (!inputModalities || inputModalities.length === 0)
    return DEFAULT_ACCEPT
  return inputModalities
    .map(m => MODALITY_ACCEPT_MAP[m])
    .filter(Boolean)
    .join(',') || DEFAULT_ACCEPT
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
    workspaceData: null,
    skills: [],
    fileResults: [],
    suggestionAnchorRect: null,
    highlightedIndex: 0,
  })

  const activeConversationsId = useMessagesStore(
    state => state.activeConversationsId,
  )
  const hasMessage = useMessagesStore(state => !!state.messages.length)
  const loading = useConversationsStore(
    state => state.streamingConversationIds.has(state.activeConversationsId),
  )
  const currentWorkspacePath = useConversationsStore(
    state => state.currentWorkspacePath,
  )

  const mcpEnabled = useChatSttingsStore(state => state.enableMCP)
  const agentMode = useChatSttingsStore(state => state.agentMode)

  const { settings } = useChatSettingsContext()

  useEffect(() => {
    if (!settings.modelId)
      return
    providerApi.getModelInfoById(settings.modelId).then(setCurrentModelInfo)
  }, [settings.modelId])

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

  const suggestionItemCount = activeReferenceTrigger?.type === 'file'
    ? senderData.fileResults.length
    : activeReferenceTrigger?.type === 'skill'
      ? filteredCommands.length + filteredSkills.length
      : 0

  const canSwitchWorkspace = !activeConversationsId && !hasMessage && !loading
  const selectableWorkspaces = useMemo(
    () => (senderData.workspaceData?.workspaces || []).filter(item => isAbsoluteWorkspacePath(item.path)),
    [senderData.workspaceData],
  )
  const canSwitchWorkspaceSelect = canSwitchWorkspace && selectableWorkspaces.length > 0
  const currentWorkspace = useMemo(
    () =>
      senderData.workspaceData?.workspaces.find(
        item => item.path === senderData.workspaceData?.currentWorkspacePath,
      ),
    [senderData.workspaceData],
  )
  const workspaceDisplayName = currentWorkspace?.displayName || '未选择工作区'
  const workspaceSwitchDisabled = workspaceLoading || !canSwitchWorkspaceSelect

  async function refreshWorkspaceData() {
    const data = await workspaceApi.listWorkspaces()
    dispatchSenderData({ type: 'SET_WORKSPACE_DATA', data })
  }

  async function refreshSkills() {
    const data = await skillApi.listSkills()
    dispatchSenderData({ type: 'SET_SKILLS', skills: data.skills })
  }

  useEffect(() => {
    void refreshWorkspaceData()

    void refreshSkills()
  }, [])

  useEffect(() => {
    if (!activeReferenceTrigger || activeReferenceTrigger.type !== 'file') {
      dispatchSenderData({ type: 'CLEAR_FILE_RESULTS' })
      return
    }

    const timer = window.setTimeout(() => {
      void workspaceApi.searchWorkspaceFiles(activeReferenceTrigger.query, 50)
        .then((results) => {
          dispatchSenderData({ type: 'SET_FILE_RESULTS', results })
        })
        .catch(() => {
          dispatchSenderData({ type: 'CLEAR_FILE_RESULTS' })
        })
    }, 120)

    return () => window.clearTimeout(timer)
  }, [activeReferenceTrigger])

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
    dispatchSenderData({ type: 'RESET_HIGHLIGHTED_INDEX' })
  }, [activeReferenceTrigger?.type, activeReferenceTrigger?.query, suggestionItemCount])

  useEffect(() => {
    if (!currentWorkspacePath) {
      return
    }

    dispatchSenderData({ type: 'SYNC_WORKSPACE_PATH', currentWorkspacePath })
  }, [currentWorkspacePath])

  async function handleSwitchWorkspace(nextWorkspacePath: string) {
    if (
      !canSwitchWorkspace
      || !senderData.workspaceData
      || nextWorkspacePath === senderData.workspaceData.currentWorkspacePath
    ) {
      return
    }
    if (!isAbsoluteWorkspacePath(nextWorkspacePath)) {
      return
    }

    setWorkspaceLoading(true)
    setNotice('')
    try {
      const data = await workspaceApi.openWorkspace(nextWorkspacePath)
      dispatchSenderData({ type: 'SET_WORKSPACE_DATA', data })
      setWorkspacePickerOpen(false)
      await setActiveConversationsId('')
      await switchWorkspaceConversationsAction(nextWorkspacePath)
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
      selectFileReference(senderData.fileResults[index])
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

    await props.onSubmit?.(content, nextReferencedFiles, nextSelectedSkill, {
      enableMCP: mcpEnabled,
    }, agentMode)
    setDraft('')
    setCursor(0)
    setReferencedFiles([])
    setSelectedSkill(undefined)
    setTextareaScrollTop(0)
  }

  return (
    <div
      ref={senderRef}
      className={`
        mx-auto max-w-(--chat-width)
        ${!hasMessage ? 'absolute inset-x-3 top-[50%] translate-y-[-50%]' : ''}
      `}
    >
      {!hasMessage && (
        <h1 className="mb-3 py-3 text-center text-4xl text-gray-500">
          <TypingEffect text="有什么可以帮忙的？" />
        </h1>
      )}

      <PromptInput
        accept={fileAccept}
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
          <div className="relative min-h-24 w-full">
            <ReferenceInputOverlay
              text={draft}
              referencedFiles={referencedFiles}
              selectedSkill={selectedSkill}
              scrollTop={textareaScrollTop}
            />
            <PromptInputTextarea
              ref={textareaRef}
              className="
                relative z-10 max-h-48 min-h-24 border-0 bg-transparent p-1 text-transparent
                caret-foreground
                selection:bg-primary/20 selection:text-foreground
                placeholder:text-muted-foreground
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
              placeholder={disabled ? '指令执行中...' : 'Enter发送消息，Shift+Enter换行'}
            />
          </div>
          <ReferenceSuggestionPanel
            trigger={activeReferenceTrigger}
            files={senderData.fileResults}
            skills={filteredSkills}
            builtinCommands={filteredCommands}
            hasWorkspace={Boolean(senderData.workspaceData?.currentWorkspacePath)}
            highlightedIndex={senderData.highlightedIndex}
            anchorRect={senderData.suggestionAnchorRect}
            onSelectFile={selectFileReference}
            onSelectSkill={selectSkillReference}
            onSelectCommand={selectCommandReference}
          />
        </PromptInputBody>

        <PromptInputFooter>
          <PromptInputTools>
            <Popover
              open={canSwitchWorkspaceSelect ? workspacePickerOpen : false}
              onOpenChange={(next) => {
                if (canSwitchWorkspaceSelect) {
                  setWorkspacePickerOpen(next)
                }
              }}
            >
              <PopoverTrigger asChild>
                <PromptInputButton
                  type="button"
                  variant="ghost"
                  data-testid="workspace-switcher"
                  disabled={workspaceLoading}
                  aria-disabled={workspaceSwitchDisabled}
                  className={`
                    h-8 max-w-52 justify-start border px-2
                    ${workspaceSwitchDisabled
      ? `
        pointer-events-none opacity-100
        hover:bg-transparent
      `
      : ''}
                  `}
                >
                  <FolderOpenIcon className="size-4 shrink-0" />
                  <span className="truncate text-xs">{workspaceDisplayName}</span>
                </PromptInputButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-1">
                <div className="max-h-60 overflow-y-auto">
                  {selectableWorkspaces.map(item => (
                    <button
                      key={item.path}
                      type="button"
                      className={`
                        flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm
                        hover:bg-black/5
                        dark:hover:bg-white/10
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

            <SenderAddAttachmentButton />
            <SenderContextUsageButton />

            <Popover>
              <PopoverTrigger asChild>
                <PromptInputButton
                  size="sm"
                  type="button"
                  variant="ghost"
                  className={`
                    ${agentMode === 'full_managed' ? 'text-orange-600' : ''}
                  `}
                >
                  {currentAgentModeOption.icon}
                  {currentAgentModeOption.label}
                  <ChevronDownIcon className="size-3" />
                </PromptInputButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-52 p-1">
                {agentModeOptions.map(item => (
                  <button
                    key={item.value}
                    type="button"
                    className={`
                      flex h-9 w-full items-center justify-between rounded-md px-2 text-sm
                      hover:bg-black/5
                      dark:hover:bg-white/10
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
              <PopoverTrigger asChild>
                <PromptInputButton
                  size="sm"
                  type="button"
                  variant={mcpEnabled ? 'secondary' : 'ghost'}
                >
                  <Cable className="size-3" />
                  MCP
                </PromptInputButton>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-[340px] p-0">
                <MCPManagementPanel />
              </PopoverContent>
            </Popover>

            {actions}
          </PromptInputTools>

          <PromptInputSubmit
            size="sm"
            data-testid={loading || disabled ? 'chat-cancel' : 'chat-submit'}
            onStop={props.onCancel}
            status={loading ? 'streaming' : disabled ? 'submitted' : 'ready'}
            variant={loading ? 'outline' : 'default'}
          >
            {loading ? '停止' : disabled ? '执行中' : '发送'}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>

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
