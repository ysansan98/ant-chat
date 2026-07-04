import type { ReactNode } from 'react'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { useEffect } from 'react'
import { useThemeApplier } from '@/hooks/useThemeApplier'
import { initializeGeneralSettings } from '@/store/generalSettings/actions'

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  useThemeApplier()

  useEffect(() => {
    initializeGeneralSettings()
  }, [])

  return (
    <TooltipProvider>
      {children}
    </TooltipProvider>
  )
}
