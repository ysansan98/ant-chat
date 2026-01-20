import type { Updater } from 'use-immer'
import React, { createContext, use } from 'react'
import { useImmer } from 'use-immer'

export type SupportedLanguages = 'mermaid' | 'html' | ''

interface RunnerCodeProps {
  config: {
    language: SupportedLanguages
    code: string
  }
  updateConfig: Updater<{
    language: SupportedLanguages
    code: string
  }>
  resetConfig: () => void
}

const RunnerCodeContext = createContext<RunnerCodeProps | undefined>(undefined)

export function RunnerCodeProvider({ children }: { children: React.ReactNode }) {
  const [config, updateConfig] = useImmer<RunnerCodeProps['config']>({
    language: '',
    code: '',
  })

  const resetConfig = () => {
    updateConfig({
      language: '',
      code: '',
    })
  }

  return (
    <RunnerCodeContext value={{ config, updateConfig, resetConfig }}>
      {children}
    </RunnerCodeContext>
  )
}

export function useRunnerCodeContext() {
  const context = use(RunnerCodeContext)
  if (context === undefined) {
    throw new Error('useMermaid must be used within a MermaidProvider')
  }
  return context
}
