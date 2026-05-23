import type { ConversationsId } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@workspace/ui/components/dialog'
import { Input } from '@workspace/ui/components/input'
import { toast } from 'sonner'

interface RenameModalProps {
  isRenameModalOpen: boolean
  closeRenameModal: () => void
  renameConversation: (renameId: ConversationsId, newName: string) => void
  renameId: string
  newName: string
  onChange: (value: string) => void
}

export default function RenameModal({ onChange, isRenameModalOpen, closeRenameModal, renameConversation, renameId, newName }: RenameModalProps) {
  return (
    <Dialog open={isRenameModalOpen} onOpenChange={closeRenameModal}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重命名</DialogTitle>
        </DialogHeader>
        <Input
          value={newName}
          onChange={(e) => {
            onChange(e.target.value)
          }}
        />
        <DialogFooter>
          <Button variant="outline" onClick={closeRenameModal}>取消</Button>
          <Button onClick={() => {
            if (newName.length < 1) {
              toast.error('名称不能为空')
              return
            }
            renameConversation(renameId as ConversationsId, newName)
            closeRenameModal()
          }}
          >
            确认
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
