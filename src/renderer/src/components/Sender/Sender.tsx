import type { ChatFeatures, IAttachment, IImage } from '@ant-chat/shared'
import type { FileUIPart } from 'ai'
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { FolderOpenIcon, GlobeIcon, PaperclipIcon, PlugZap } from 'lucide-react'
import {
  useEffect,
  useMemo,
  useState,
} from 'react'
import workspaceApi from '@/api/workspaceApi'
import {
  setOnlieSearch,
  useChatSttingsStore,
} from '@/store/chatSettings'
import {
  switchWorkspaceConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { fileToBase64 } from '@/utils'
import TypingEffect from '../TypingEffect'
import MCPManagementPanel from './MCPManagementPanel'

interface SenderProps {
  actions?: React.ReactNode
  onSubmit?: (
    message: string,
    images: IImage[],
    attachments: IAttachment[],
    features: ChatFeatures,
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
    uid: `${filename}-${index}`,
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

function Sender({ actions, ...props }: SenderProps) {
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false)
  const [workspaceData, setWorkspaceData] = useState<
    Awaited<ReturnType<typeof workspaceApi.listWorkspaces>> | null
  >(null)
  const [notice, setNotice] = useState('')

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
  const onlineSearch = useChatSttingsStore(state => state.onlineSearch)

  const canSwitchWorkspace = !activeConversationsId && !hasMessage && !loading
  const selectableWorkspaces = useMemo(
    () => (workspaceData?.workspaces || []).filter(item => item.path.startsWith('/')),
    [workspaceData],
  )
  const canSwitchWorkspaceSelect = canSwitchWorkspace && selectableWorkspaces.length > 0
  const currentWorkspace = useMemo(
    () =>
      workspaceData?.workspaces.find(
        item => item.path === workspaceData.currentWorkspacePath,
      ),
    [workspaceData],
  )
  const workspaceDisplayName = currentWorkspace?.displayName || '未选择工作区'
  const workspaceSwitchDisabled = workspaceLoading || !canSwitchWorkspaceSelect

  useEffect(() => {
    void refreshWorkspaceData()
  }, [])

  useEffect(() => {
    if (!currentWorkspacePath) {
      return
    }

    setWorkspaceData((prev) => {
      if (!prev || prev.currentWorkspacePath === currentWorkspacePath) {
        return prev
      }

      return {
        ...prev,
        currentWorkspacePath,
      }
    })
  }, [currentWorkspacePath])

  async function refreshWorkspaceData() {
    const data = await workspaceApi.listWorkspaces()
    setWorkspaceData(data)
  }

  async function handleSwitchWorkspace(nextWorkspacePath: string) {
    if (
      !canSwitchWorkspace
      || !workspaceData
      || nextWorkspacePath === workspaceData.currentWorkspacePath
    ) {
      return
    }
    if (!nextWorkspacePath.startsWith('/')) {
      return
    }

    setWorkspaceLoading(true)
    setNotice('')
    try {
      const data = await workspaceApi.openWorkspace(nextWorkspacePath)
      setWorkspaceData(data)
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

  async function handleSubmit(message: { text: string, files: FileUIPart[] }) {
    const images: IImage[] = []
    const attachments: IAttachment[] = []

    const files = await Promise.all(
      message.files.map((part, index) => filePartToAttachment(part, index)),
    )

    files.forEach((file) => {
      if (!file) {
        return
      }

      if (file.type.includes('image')) {
        images.push(file)
      }
      else {
        attachments.push(file)
      }
    })

    props.onSubmit?.(message.text, images, attachments, {
      enableMCP: mcpEnabled,
      onlineSearch,
    })
  }

  return (
    <div
      className={`
        ${!hasMessage ? 'absolute inset-x-3 top-[50%] translate-y-[-50%]' : ''}
      `}
    >
      {!hasMessage && (
        <h1 className="mb-3 py-3 text-center text-4xl text-gray-500">
          <TypingEffect text="有什么可以帮忙的？" />
        </h1>
      )}

      <PromptInput
        accept="image/*,application/pdf,text/*,.md,.mp4"
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
          <PromptInputTextarea
            className="max-h-48 min-h-24 border-0 bg-transparent p-1"
            placeholder="Enter发送消息，Shift+Enter换行"
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

            <PromptInputButton
              type="button"
              variant={onlineSearch ? 'secondary' : 'ghost'}
              onClick={() => setOnlieSearch(!onlineSearch)}
            >
              <GlobeIcon className="size-3" />
              联网搜索
            </PromptInputButton>

            <Popover>
              <PopoverTrigger asChild>
                <PromptInputButton
                  size="sm"
                  type="button"
                  variant={mcpEnabled ? 'secondary' : 'ghost'}
                >
                  <PlugZap className="size-3" />
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
            onStop={props.onCancel}
            status={loading ? 'streaming' : 'ready'}
            variant={loading ? 'outline' : 'default'}
          >
            {loading ? '停止' : '发送'}
          </PromptInputSubmit>
        </PromptInputFooter>
      </PromptInput>

      {notice && (
        <div className="mt-2 text-xs text-red-500">{notice}</div>
      )}

    </div>
  )
}

export default Sender
