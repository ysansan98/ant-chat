import type { CommandHostStatus } from '@ant-chat/shared'
import type { ReactNode } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { TooltipProvider } from '@workspace/ui/components/tooltip'
import { AlertTriangle, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { getAppRpcClient } from '@/api/transports/appRpc'
import { useThemeApplier } from '@/hooks/useThemeApplier'
import { initializeGeneralSettings } from '@/store/generalSettings/actions'

interface AppProvidersProps {
  children: ReactNode
}

export function AppProviders({ children }: AppProvidersProps) {
  const [commandHostStatus, setCommandHostStatus] = useState<CommandHostStatus | null>(null)
  const [commandHostWarningDismissed, setCommandHostWarningDismissed] = useState(false)
  useThemeApplier()

  useEffect(() => {
    initializeGeneralSettings()
    void getAppRpcClient().call('runtime.getCommandHostStatus', undefined).then(setCommandHostStatus).catch(() => {})
  }, [])

  return (
    <TooltipProvider>
      {children}
      {commandHostStatus?.status === 'unavailable' && !commandHostWarningDismissed && (
        <CommandHostWarning
          status={commandHostStatus}
          onClose={() => setCommandHostWarningDismissed(true)}
        />
      )}
    </TooltipProvider>
  )
}

function CommandHostWarning({
  status,
  onClose,
}: {
  status: Extract<CommandHostStatus, { status: 'unavailable' }>
  onClose: () => void
}) {
  const recoveryAdvice = status.platform === 'windows'
    ? '请安装 PowerShell 7，或检查 powershell.exe、cmd.exe 是否可执行。'
    : '请检查 Bash 是否已安装且可执行。'

  return (
    <Alert
      variant="destructive"
      className="fixed top-5 left-1/2 z-10000 w-[min(42rem,calc(100%-2rem))] -translate-x-1/2 shadow-lg"
    >
      <AlertTriangle />
      <AlertTitle>命令执行功能已停用</AlertTitle>
      <AlertDescription>
        {status.reason}
        {' '}
        {recoveryAdvice}
      </AlertDescription>
      <AlertAction>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭命令宿主警告" onClick={onClose}>
          <X />
        </Button>
      </AlertAction>
    </Alert>
  )
}
