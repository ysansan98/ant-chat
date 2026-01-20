import type { ConversationsId } from '@ant-chat/shared'
import { App, Input, Modal } from 'antd'

interface RenameModalProps {
  isRenameModalOpen: boolean
  closeRenameModal: () => void
  renameConversation: (renameId: ConversationsId, newName: string) => void
  renameId: string
  newName: string
  onChange: (value: string) => void

}

export default function RenameModal({ onChange, isRenameModalOpen, closeRenameModal, renameConversation, renameId, newName }: RenameModalProps) {
  const { message } = App.useApp()
  return (
    <Modal
      title="重命名"
      open={isRenameModalOpen}
      onCancel={() => closeRenameModal()}
      onOk={() => {
        if (newName.length < 1) {
          message.error('名称不能为空')
          throw new Error('名称不能为空')
        }
        renameConversation(renameId as ConversationsId, newName)
        closeRenameModal()
      }}
      cancelText="取消"
    >
      <Input
        value={newName}
        onChange={(e) => {
          onChange(e.target.value)
        }}
      />
    </Modal>
  )
}
