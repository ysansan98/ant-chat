import { useChatSttingsStore } from './store'

export function setOnlieSearch(value: boolean) {
  useChatSttingsStore.setState({ onlineSearch: value })
}

export function setEnableMCP(value: boolean) {
  useChatSttingsStore.setState({ enableMCP: value })
}
