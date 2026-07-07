import { createContext, use } from 'react'

interface SidebarContextValue {
  showSliderMenu: boolean
}

const SidebarContext = createContext<SidebarContextValue>({ showSliderMenu: true })

export function useSidebar() {
  return use(SidebarContext)
}

export const SidebarProvider = SidebarContext.Provider
