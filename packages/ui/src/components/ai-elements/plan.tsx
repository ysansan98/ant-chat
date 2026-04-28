'use client'

import type { ComponentProps } from 'react'
import { Button } from '@workspace/ui/components/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@workspace/ui/components/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronsUpDownIcon } from 'lucide-react'
import { createContext, use, useMemo } from 'react'

import { Shimmer } from './shimmer'

interface PlanContextValue {
  isStreaming: boolean
}

const PlanContext = createContext<PlanContextValue | null>(null)

function usePlan() {
  const context = use(PlanContext)
  if (!context) {
    throw new Error('Plan components must be used within Plan')
  }
  return context
}

export type PlanProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean
}

export function Plan({
  className,
  isStreaming = false,
  children,
  ...props
}: PlanProps) {
  const contextValue = useMemo(() => ({ isStreaming }), [isStreaming])

  return (
    <PlanContext value={contextValue}>
      <Collapsible asChild data-slot="plan" {...props}>
        <Card className={cn('shadow-none', className)}>{children}</Card>
      </Collapsible>
    </PlanContext>
  )
}

export type PlanHeaderProps = ComponentProps<typeof CardHeader>

export function PlanHeader({ className, ...props }: PlanHeaderProps) {
  return (
    <CardHeader
      className={cn('flex items-start justify-between', className)}
      data-slot="plan-header"
      {...props}
    />
  )
}

export type PlanTitleProps = Omit<
  ComponentProps<typeof CardTitle>,
  'children'
> & {
  children: string
}

export function PlanTitle({ children, ...props }: PlanTitleProps) {
  const { isStreaming } = usePlan()

  return (
    <CardTitle data-slot="plan-title" {...props}>
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardTitle>
  )
}

export type PlanDescriptionProps = Omit<
  ComponentProps<typeof CardDescription>,
  'children'
> & {
  children: string
}

export function PlanDescription({
  className,
  children,
  ...props
}: PlanDescriptionProps) {
  const { isStreaming } = usePlan()

  return (
    <CardDescription
      className={cn('text-balance', className)}
      data-slot="plan-description"
      {...props}
    >
      {isStreaming ? <Shimmer>{children}</Shimmer> : children}
    </CardDescription>
  )
}

export type PlanActionProps = ComponentProps<typeof CardAction>

export function PlanAction(props: PlanActionProps) {
  return <CardAction data-slot="plan-action" {...props} />
}

export type PlanContentProps = ComponentProps<typeof CardContent>

export function PlanContent(props: PlanContentProps) {
  return (
    <CollapsibleContent asChild>
      <CardContent data-slot="plan-content" {...props} />
    </CollapsibleContent>
  )
}

export type PlanFooterProps = ComponentProps<'div'>

export function PlanFooter(props: PlanFooterProps) {
  return <CardFooter data-slot="plan-footer" {...props} />
}

export type PlanTriggerProps = ComponentProps<typeof CollapsibleTrigger>

export function PlanTrigger({ className, ...props }: PlanTriggerProps) {
  return (
    <CollapsibleTrigger asChild>
      <Button
        className={cn('size-8', className)}
        data-slot="plan-trigger"
        size="icon"
        variant="ghost"
        {...props}
      >
        <ChevronsUpDownIcon className="size-4" />
        <span className="sr-only">Toggle plan</span>
      </Button>
    </CollapsibleTrigger>
  )
}
