import { useImmerReducer } from 'use-immer'

const initialState = {
  isRenameModalOpen: false,
  newName: '',
  renameId: '',
}

interface StartRenameAction {
  type: 'startRename'
  id: string
  title: string
}

interface EndRenameAction {
  type: 'endRename'
}

interface ChangeRenameAction {
  type: 'changeRename'
  title: string
}

type RenameInitialState = typeof initialState

type RenameReducerAction = StartRenameAction | EndRenameAction | ChangeRenameAction

function renameReducer(draft: RenameInitialState, action: RenameReducerAction) {
  switch (action.type) {
    case 'startRename': {
      draft.isRenameModalOpen = true
      draft.renameId = action.id
      draft.newName = action.title
      break
    }
    case 'endRename': {
      draft.isRenameModalOpen = false
      draft.renameId = ''
      draft.newName = ''
      break
    }

    case 'changeRename': {
      draft.newName = action.title
      break
    }
  }
}

export function useConversationRename() {
  const [state, dispatch] = useImmerReducer(renameReducer, initialState)

  function openRenameModal(id: string, title: string) {
    dispatch({ type: 'startRename', id, title })
  }

  function closeRenameModal() {
    dispatch({ type: 'endRename' })
  }

  function changeRename(title: string) {
    dispatch({ type: 'changeRename', title })
  }

  return {
    ...state,
    openRenameModal,
    closeRenameModal,
    changeRename,
  }
}
