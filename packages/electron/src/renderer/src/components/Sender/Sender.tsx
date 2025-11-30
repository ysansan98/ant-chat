import type { ChatFeatures, IAttachment, IImage } from '@ant-chat/shared'
import type { GetRef, UploadFile } from 'antd'
import Icon, {
  CloudUploadOutlined,
  GlobalOutlined,
  PaperClipOutlined,
} from '@ant-design/icons'

import { Attachments, Sender as SenderX } from '@ant-design/x'
import { App, Badge, Button, Flex, Popover, Tooltip } from 'antd'
import { useRef, useState } from 'react'
import MCPIcon from '@/assets/icons/mcp.svg?react'
import { setOnlieSearch, useChatSttingsStore } from '@/store/chatSettings'
import { useConversationsStore } from '@/store/conversation'
import { useMessagesStore } from '@/store/messages'
import { fileToBase64 } from '@/utils'
import TypingEffect from '../TypingEffect'
import MCPManagementPanel from './MCPManagementPanel'

interface SenderProps {
  actions?: React.ReactNode
  onSubmit?: (message: string, images: IImage[], attachments: IAttachment[], features: ChatFeatures) => void
  onCancel?: () => void
}

function Sender({ actions, ...props }: SenderProps) {
  const { message } = App.useApp()
  const [openHeader, setOpenHeader] = useState(false)
  const [attachmentList, setAttachmentList] = useState<UploadFile[]>([])
  const hasMessage = useMessagesStore(state => !!state.messages.length)
  const loading = useConversationsStore(state => state.streamingConversationIds.has(state.activeConversationsId))
  const senderRef = useRef<GetRef<typeof SenderX>>(null)

  // ============================ MCP、联网搜索 ============================
  const mcpEnabled = useChatSttingsStore(state => state.enableMCP)
  const onlineSearch = useChatSttingsStore(state => state.onlineSearch)

  async function transformAttachments() {
    const images: IAttachment[] = []
    const attachments: IAttachment[] = []

    if (attachmentList.length) {
      for (const item of attachmentList) {
        const { originFileObj, uid, name, type, size } = item as Required<UploadFile>
        const data = await fileToBase64(originFileObj)
        const result = { uid, name, size, type, data }
        if (type.includes('image')) {
          images.push(result)
        }
        else {
          attachments.push(result)
        }
      }
    }

    return { images, attachments }
  }

  async function handleSubmit(text: string) {
    const { images, attachments } = await transformAttachments()
    props?.onSubmit?.(text, images, attachments, { enableMCP: mcpEnabled, onlineSearch })
    setAttachmentList([])
    setOpenHeader(false)
  }

  return (
    <div
      className={`
        ${!hasMessage ? 'absolute top-[50%] right-3 left-3 translate-y-[-50%]' : ''}
      `}
    >
      {
        !hasMessage && (
          <h1 className="mb-3 py-3 text-center text-4xl text-gray-500">
            <TypingEffect text="有什么可以帮忙的？" />
          </h1>
        )
      }
      <SenderX
        ref={senderRef}
        loading={loading}
        header={(
          <SenderX.Header
            title="附件"
            open={openHeader}
            onOpenChange={setOpenHeader}
            forceRender
          >
            <Attachments
              multiple
              overflow="scrollX"
              beforeUpload={() => false}
              items={attachmentList}
              onChange={({ fileList }) => {
                const result: UploadFile[] = []
                fileList.forEach((item) => {
                  if (item.size && item.size > 1024 * 1024 * 20) {
                    message.warning('文件大小不能超过20MB')
                    return
                  }

                  // 识别Markdown文件
                  if (item.name.toLowerCase().endsWith('.md')) {
                    item.type = 'text/md'
                  }

                  result.push(item)
                })

                setAttachmentList(result)
              }}
              placeholder={{
                icon: <CloudUploadOutlined />,
                title: '上传图片或文档',
              }}
              accept="image/*,application/pdf,text/*,.md,.mp4"
            />
          </SenderX.Header>

        )}
        footer={(_, { components }) => {
          const { SendButton, LoadingButton } = components
          return (
            <Flex justify="space-between" align="center">
              <Flex gap="small" align="center">
                <Tooltip title="附件(支持文档与图片)">
                  <Badge dot={(attachmentList.length > 0) && !openHeader}>
                    <Button
                      onClick={() => {
                        setOpenHeader(!openHeader)
                      }}
                      icon={<PaperClipOutlined />}
                    />
                  </Badge>
                </Tooltip>

                <Tooltip title="联网搜索(目前仅Gemini支持)">
                  <div>
                    <SenderX.Switch
                      value={onlineSearch}
                      onChange={setOnlieSearch}
                      icon={<GlobalOutlined />}
                    />
                  </div>
                </Tooltip>
                <Popover
                  content={<MCPManagementPanel />}
                  trigger="click"
                  getPopupContainer={() => document.body}
                >
                  <SenderX.Switch
                    value={mcpEnabled}
                    icon={<Icon component={MCPIcon} />}
                  />
                </Popover>
                {actions}
              </Flex>
              <Flex gap="small" align="center">
                {
                  loading
                    ? (<LoadingButton />)
                    : (<SendButton />)
                }
              </Flex>
            </Flex>
          )
        }}
        suffix={false}
        placeholder="Enter发送消息，Shift+Enter换行"
        autoSize={{ minRows: 3, maxRows: 6 }}
        onSubmit={(e) => {
          handleSubmit(e)
          if (senderRef.current) {
            senderRef.current?.clear?.()
          }
        }}
        onCancel={() => {
          props.onCancel?.()
        }}
      />
      <div>
      </div>
    </div>
  )
}

export default Sender
