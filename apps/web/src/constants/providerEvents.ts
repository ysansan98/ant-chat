export const PROVIDER_CHANGED_EVENT = 'ant-chat:provider-changed'

export function emitProviderChanged() {
  window.dispatchEvent(new Event(PROVIDER_CHANGED_EVENT))
}
