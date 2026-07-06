export const AUTOMATION_CHANGED_EVENT = 'ant-chat:automation-changed'
export const AUTOMATION_RUN_CHANGED_EVENT = 'ant-chat:automation-run-changed'

export function emitAutomationChanged() {
  window.dispatchEvent(new Event(AUTOMATION_CHANGED_EVENT))
}

export function emitAutomationRunChanged() {
  window.dispatchEvent(new Event(AUTOMATION_RUN_CHANGED_EVENT))
}
