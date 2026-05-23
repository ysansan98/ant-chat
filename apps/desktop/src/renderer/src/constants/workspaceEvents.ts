export const WORKSPACE_CHANGED_EVENT = 'ant-chat:workspace-changed'

export function emitWorkspaceChanged() {
  window.dispatchEvent(new Event(WORKSPACE_CHANGED_EVENT))
}
