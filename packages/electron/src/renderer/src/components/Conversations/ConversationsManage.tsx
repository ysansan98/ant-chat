import type { ConversationsId, IConversations } from '@ant-chat/shared'
import type { ConversationsProps } from '@ant-design/x'
import type { MenuProps } from 'antd'
import { ClearOutlined, DeleteOutlined, EditOutlined, EllipsisOutlined, MessageOutlined } from '@ant-design/icons'
import { Conversations } from '@ant-design/x'
import { App, Button, Dropdown, Space } from 'antd'
import dayjs from 'dayjs'
import { lazy, Suspense, useState } from 'react'
import { useConversationRename } from '@/hooks/useConversationRename'
import {
  clearConversationsAction,
  deleteConversationsAction,
  importConversationsAction,
  nextPageConversationsAction,
  renameConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { importAntChatFile } from '@/utils'
import { InfiniteScroll } from '../InfiniteScroll'
import Loading from '../Loading'

const RenameModal = lazy(() => import('./RenameModal'))

export default function ConversationsManage() {
  const { message, modal } = App.useApp()
  const {
    openRenameModal,
    changeRename,
    closeRenameModal,
    isRenameModalOpen,
    newName,
    renameId,
  } = useConversationRename()

  const [loading, setLoading] = useState(false)
  const conversations = useConversationsStore(state => state.conversations)
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const pageIndex = useConversationsStore(state => state.pageIndex)
  const conversationsTotal = useConversationsStore(state => state.conversationsTotal)

  const hasMore = conversationsTotal > conversations.length

  const disabledClear = conversations.length === 0

  const dropdownButtons = [
    // { key: 'import', label: '导入', icon: <ImportOutlined /> },
    // { key: 'export', label: '导出', icon: <ExportOutlined /> },
    { key: 'clear', label: '清空', icon: <ClearOutlined />, danger: true, disabled: disabledClear },
  ]

  const conversationsMenuConfig: ConversationsProps['menu'] = conversation => ({
    items: [
      { key: 'rename', label: '重命名', icon: <EditOutlined /> },
      { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
    ],
    onClick: (e) => {
      e.domEvent.stopPropagation()
      if (e.key === 'rename') {
        openRenameModal(conversation.key, conversation.label as string)
      }
      else if (e.key === 'delete') {
        modal.confirm({
          title: '删除对话',
          content: '删除后将无法恢复，请谨慎操作',
          cancelText: '取消',
          okType: 'danger',
          okText: '删除',
          onOk: () => {
            deleteConversationsAction(conversation.key as ConversationsId)
          },
        })
      }
    },
  })

  const items = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt).map((item) => {
    const { id: key, title: label } = item
    return { key, label, icon: <MessageOutlined />, group: getGroup(item) }
  })

  const onClickMenu: MenuProps['onClick'] = async (e) => {
    async function handleImport() {
      try {
        const data = await importAntChatFile()
        importConversationsAction(data)

        message.success('导入成功')
      }
      catch (error: unknown) {
        message.error((error as Error).message)
      }
    }

    async function handleExport() {
      message.error('等待实现～')
      throw new Error('等待实现～')
    }

    function handleClear() {
      modal.confirm({
        title: '清空对话',
        content: '清空后将无法恢复，请谨慎操作',
        cancelText: '取消',
        okType: 'danger',
        okText: '清空',
        onOk: () => {
          clearConversationsAction()
          message.success('清空成功')
        },
      })
    }

    const handleMapping = {
      import: handleImport,
      export: handleExport,
      clear: handleClear,
    }

    const key = e.key as keyof typeof handleMapping
    const func = handleMapping[key]
    func ? func() : console.error('unknown key', key)
  }

  async function onActiveChange(value: ConversationsId) {
    await setActiveConversationsId(value)
  }

  return (
    <div className="grid h-full grid-rows-[max-content_1fr_max-content]">
      <div className="w-full px-1 py-2">
        <Space className="w-full" classNames={{ item: 'w-full' }}>
          <Space.Compact className="w-full">
            <Button
              type="primary"
              key={0}
              className="flex-1"
              onClick={async () => {
                await setActiveConversationsId('')
              }}
            >
              新对话
            </Button>
            <Dropdown menu={{ items: dropdownButtons, onClick: onClickMenu }}>
              <Button type="primary" icon={<EllipsisOutlined />} />
            </Dropdown>
          </Space.Compact>
        </Space>
      </div>
      <InfiniteScroll
        hasMore={hasMore}
        loading={loading}
        direction="bottom"
        noMoreComponent={pageIndex > 0 ? (<div className="py-1 text-center text-gray-500">已经到底了~</div>) : null}
        onLoadMore={async () => {
          if (loading) {
            return
          }
          setLoading(true)
          await nextPageConversationsAction()
          setLoading(false)
        }}
      >

        <Conversations
          groupable
          activeKey={activeConversationsId}
          menu={conversationsMenuConfig}
          onActiveChange={(value: string) => onActiveChange(value as ConversationsId)}
          items={items}
        />
      </InfiniteScroll>
      <Suspense fallback={<Loading />}>
        <RenameModal
          isRenameModalOpen={isRenameModalOpen}
          closeRenameModal={closeRenameModal}
          renameConversation={renameConversationsAction}
          renameId={renameId as string}
          newName={newName}
          onChange={changeRename}
        />
      </Suspense>
    </div>
  )
}

function getGroup(item: IConversations) {
  const now = dayjs()
  const createAtDate = dayjs(item.updatedAt)
  const createAtTs = createAtDate.valueOf()
  const todayStart = now.startOf('day').valueOf()
  const yesterdayStart = now.subtract(1, 'day').startOf('day').valueOf()

  if (createAtTs >= todayStart)
    return '今日'

  if (createAtTs >= yesterdayStart)
    return '昨日'

  if (createAtDate.isSame(now, 'week'))
    return '本周'

  if (createAtDate.isSame(now, 'month'))
    return '本月'

  return createAtDate.format('YYYY-MM')
}
