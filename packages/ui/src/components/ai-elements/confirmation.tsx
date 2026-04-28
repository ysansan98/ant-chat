'use client'

import type { ToolUIPart } from 'ai'
import type { ComponentProps, ReactNode } from 'react'
import { Alert, AlertDescription } from '@workspace/ui/components/alert'
import { Button } from '@workspace/ui/components/button'
import { cn } from '@workspace/ui/lib/utils'
import { createContext, use, useMemo } from 'react'

type ToolUIPartApproval
  = | {
    id: string
    approved?: never
    reason?: never
  }
  | {
    id: string
    approved: boolean
    reason?: string
  }
  | {
    id: string
    approved: true
    reason?: string
  }
  | {
    id: string
    approved: true
    reason?: string
  }
  | {
    id: string
    approved: false
    reason?: string
  }
  | undefined

interface ConfirmationContextValue {
  approval: ToolUIPartApproval
  state: ToolUIPart['state']
}

const ConfirmationContext = createContext<ConfirmationContextValue | null>(
  null,
)

function useConfirmation() {
  const context = use(ConfirmationContext)

  if (!context) {
    throw new Error('Confirmation components must be used within Confirmation')
  }

  return context
}

export type ConfirmationProps = ComponentProps<typeof Alert> & {
  approval?: ToolUIPartApproval
  state: ToolUIPart['state']
}

export function Confirmation({
  className,
  approval,
  state,
  ...props
}: ConfirmationProps) {
  const contextValue = useMemo(() => ({ approval, state }), [approval, state])

  if (!approval || state === 'input-streaming' || state === 'input-available') {
    return null
  }

  return (
    <ConfirmationContext value={contextValue}>
      <Alert className={cn('flex flex-col gap-2', className)} {...props} />
    </ConfirmationContext>
  )
}

export type ConfirmationTitleProps = ComponentProps<typeof AlertDescription>

export function ConfirmationTitle({
  className,
  ...props
}: ConfirmationTitleProps) {
  return <AlertDescription className={cn('inline', className)} {...props} />
}

export interface ConfirmationRequestProps {
  children?: ReactNode
}

export function ConfirmationRequest({ children }: ConfirmationRequestProps) {
  const { state } = useConfirmation()

  // Only show when approval is requested
  if (state !== 'approval-requested') {
    return null
  }

  return children
}

export interface ConfirmationAcceptedProps {
  children?: ReactNode
}

export function ConfirmationAccepted({
  children,
}: ConfirmationAcceptedProps) {
  const { approval, state } = useConfirmation()

  // Only show when approved and in response states
  if (
    !approval?.approved
    || (state !== 'approval-responded'
      && state !== 'output-denied'
      && state !== 'output-available')
  ) {
    return null
  }

  return children
}

export interface ConfirmationRejectedProps {
  children?: ReactNode
}

export function ConfirmationRejected({
  children,
}: ConfirmationRejectedProps) {
  const { approval, state } = useConfirmation()

  // Only show when rejected and in response states
  if (
    approval?.approved !== false
    || (state !== 'approval-responded'
      && state !== 'output-denied'
      && state !== 'output-available')
  ) {
    return null
  }

  return children
}

export type ConfirmationActionsProps = ComponentProps<'div'>

export function ConfirmationActions({
  className,
  ...props
}: ConfirmationActionsProps) {
  const { state } = useConfirmation()

  // Only show when approval is requested
  if (state !== 'approval-requested') {
    return null
  }

  return (
    <div
      className={cn('flex items-center justify-end gap-2 self-end', className)}
      {...props}
    />
  )
}

export type ConfirmationActionProps = ComponentProps<typeof Button>

export function ConfirmationAction(props: ConfirmationActionProps) {
  return <Button className="h-8 px-3 text-sm" type="button" {...props} />
}
