import { AnimatePresence, motion } from 'motion/react'
import React from 'react'
import { setActiveConversationsId } from '@/store/messages'
import { SearchBar } from './SearchBar'

export function SearchContainer() {
  const [openModal, setOpenModal] = React.useState(false)

  React.useEffect(
    () => {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault()
          setOpenModal(!openModal)
        }

        if (!openModal) {
          return
        }

        if (e.key === 'Escape' && openModal) {
          e.preventDefault()
          setOpenModal(false)
        }
      }

      window.addEventListener('keydown', handleKeyDown)

      return () => {
        window.removeEventListener('keydown', handleKeyDown)
      }
    },
  )

  return (
    <AnimatePresence>
      {
        openModal
          ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed top-0 right-0 bottom-0 left-0 z-50 bg-black/10 backdrop-blur-sm"
                onClick={(e) => {
                  if (e.target === e.currentTarget) {
                    setOpenModal(false)
                  }
                }}
              >
                <SearchBar onItemClick={(item, _) => {
                  setOpenModal(false)
                  setActiveConversationsId(item.conversationId)
                }}
                />
              </motion.div>
            )
          : null
      }
    </AnimatePresence>

  )
}
