import React from 'react'
import { activatePersistedConversationSession } from '@/store/workspaceSession'
import { SearchBar } from './SearchBar'

export function SearchContainer() {
  const [openModal, setOpenModal] = React.useState(false)
  const [visible, setVisible] = React.useState(false)

  // Handle enter/exit transitions with a mounted state
  React.useEffect(() => {
    if (openModal) {
      setVisible(true)
    }
  }, [openModal])

  function handleClose() {
    setOpenModal(false)
  }

  function handleTransitionEnd() {
    if (!openModal) {
      setVisible(false)
    }
  }

  React.useEffect(
    () => {
      const openSearch = () => {
        setOpenModal(true)
      }
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          setOpenModal(prev => !prev)
        }

        if (!openModal) {
          return
        }

        if (e.key === 'Escape' && openModal) {
          e.preventDefault()
          setOpenModal(false)
        }
      }

      window.addEventListener('ant-chat:open-search', openSearch)
      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('ant-chat:open-search', openSearch)
        window.removeEventListener('keydown', handleKeyDown)
      }
    },
    [openModal],
  )

  if (!visible && !openModal) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 bg-black/10 backdrop-blur-sm transition-opacity duration-200 ${openModal ? 'opacity-100' : 'opacity-0'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          handleClose()
        }
      }}
      onTransitionEnd={handleTransitionEnd}
    >
      <SearchBar
        onClose={handleClose}
        onItemClick={(item, _) => {
          handleClose()
          void activatePersistedConversationSession(item.conversationId)
        }}
      />
    </div>
  )
}
