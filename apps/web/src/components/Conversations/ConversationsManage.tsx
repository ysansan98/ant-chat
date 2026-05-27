import type { ConversationsId, IConversations } from '@ant-chat/shared'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@workspace/ui/components/alert-dialog'
import { Button } from '@workspace/ui/components/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@workspace/ui/components/dropdown-menu'
import dayjs from 'dayjs'
import { Brush, Ellipsis, MessageSquare, Pencil, Trash2 } from 'lucide-react'
import { lazy, Suspense, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useConversationRename } from '@/hooks/useConversationRename'
import {
  clearConversationsAction,
  deleteConversationsAction,
  nextPageConversationsAction,
  renameConversationsAction,
  useConversationsStore,
} from '@/store/conversation'
import { setActiveConversationsId, useMessagesStore } from '@/store/messages'
import { InfiniteScroll } from '../InfiniteScroll'
import Loading from '../Loading'
import { WorkspaceSelector } from '../Workspace/WorkspaceSelector'

const RenameModal = lazy(() => import('./RenameModal'))

interface ConversationsManageProps {
  showHeader?: boolean
}

export default function ConversationsManage({ showHeader = true }: ConversationsManageProps) {
  const {
    openRenameModal,
    changeRename,
    closeRenameModal,
    isRenameModalOpen,
    newName,
    renameId,
  } = useConversationRename()

  const [loading, setLoading] = useState(false)
  const [confirmAction, setConfirmAction] = useState<'delete' | 'clear' | null>(null)
  const [confirmConvId, setConfirmConvId] = useState<ConversationsId | null>(null)

  const conversations = useConversationsStore(state => state.conversations)
  const activeConversationsId = useMessagesStore(state => state.activeConversationsId)
  const pageIndex = useConversationsStore(state => state.pageIndex)
  const conversationsTotal = useConversationsStore(state => state.conversationsTotal)

  const hasMore = conversationsTotal > conversations.length
  const disabledClear = conversations.length === 0

  const groupedItems = useMemo(() => {
    const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
    const groups: Record<string, typeof sorted> = {}
    sorted.forEach((item) => {
      const group = getGroup(item)
      if (!groups[group])
        groups[group] = []
      groups[group].push(item)
    })
    return groups
  }, [conversations])

  return (
    <div className="grid h-full grid-rows-[max-content_1fr_max-content]">
      {showHeader && (
        <div className="w-full px-1 py-2">
          <div className="mb-2">
            <WorkspaceSelector />
          </div>
          <div className="flex w-full gap-0">
            <Button
              className="flex-1 rounded-r-none"
              onClick={async () => {
                await setActiveConversationsId('')
              }}
            >
              新对话
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button className="rounded-l-none px-2" variant="outline">
                  <Ellipsis />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem disabled={disabledClear} onClick={() => setConfirmAction('clear')}>
                  <Brush />
                  清空对话
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      )}
      <InfiniteScroll
        hasMore={hasMore}
        loading={loading}
        direction="bottom"
        noMoreComponent={pageIndex > 0 ? (<div className="py-1 text-center text-gray-500">已经到底了~</div>) : null}
        onLoadMore={async () => {
          if (loading)
            return
          setLoading(true)
          await nextPageConversationsAction()
          setLoading(false)
        }}
      >
        <div className="flex flex-col gap-1 px-1">
          {Object.entries(groupedItems).map(([group, items]) => (
            <div key={group} className="mb-2">
              <div className="px-3 py-1 text-xs font-medium text-muted-foreground">{group}</div>
              {items.map(item => (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  className={`
                    group flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm
                    transition-colors
                    hover:bg-muted
                    ${
                activeConversationsId === item.id ? 'bg-muted font-medium' : ''
                }
                  `}
                  onClick={async () => {
                    await setActiveConversationsId(item.id as ConversationsId)
                  }}
                  onKeyDown={async (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      await setActiveConversationsId(item.id as ConversationsId)
                    }
                  }}
                >
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{item.title}</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="
                          ml-auto shrink-0 opacity-0
                          group-hover:opacity-100
                        "
                        onClick={e => e.stopPropagation()}
                      >
                        <Ellipsis className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={(e) => {
                        e.stopPropagation()
                        openRenameModal(item.id, item.title)
                      }}
                      >
                        <Pencil />
                        重命名
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={(e) => {
                          e.stopPropagation()
                          setConfirmConvId(item.id as ConversationsId)
                          setConfirmAction('delete')
                        }}
                      >
                        <Trash2 />
                        删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          ))}
        </div>
      </InfiniteScroll>

      {/* Confirm dialogs */}
      <AlertDialog open={confirmAction === 'clear'} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>清空对话</AlertDialogTitle>
            <AlertDialogDescription>
              清空后将无法恢复，请谨慎操作
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                clearConversationsAction()
                toast.success('清空成功')
                setConfirmAction(null)
              }}
            >
              清空
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmAction === 'delete'} onOpenChange={() => setConfirmAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话</AlertDialogTitle>
            <AlertDialogDescription>
              删除后将无法恢复，请谨慎操作
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (confirmConvId) {
                  deleteConversationsAction(confirmConvId)
                }
                setConfirmAction(null)
                setConfirmConvId(null)
              }}
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
