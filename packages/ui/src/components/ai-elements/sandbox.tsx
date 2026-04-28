'use client'

import type { ToolUIPart } from 'ai'
import type { ComponentProps } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@workspace/ui/components/collapsible'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@workspace/ui/components/tabs'
import { cn } from '@workspace/ui/lib/utils'
import { ChevronDownIcon, Code } from 'lucide-react'

import { getStatusBadge } from './tool'

export type SandboxRootProps = ComponentProps<typeof Collapsible>

export function Sandbox({ className, ...props }: SandboxRootProps) {
  return (
    <Collapsible
      className={cn(
        'not-prose group mb-4 w-full overflow-hidden rounded-md border',
        className,
      )}
      defaultOpen
      {...props}
    />
  )
}

export interface SandboxHeaderProps {
  title?: string
  state: ToolUIPart['state']
  className?: string
}

export function SandboxHeader({
  className,
  title,
  state,
  ...props
}: SandboxHeaderProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        'flex w-full items-center justify-between gap-4 p-3',
        className,
      )}
      {...props}
    >
      <div className="flex items-center gap-2">
        <Code className="size-4 text-muted-foreground" />
        <span className="font-medium text-sm">{title}</span>
        {getStatusBadge(state)}
      </div>
      <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
    </CollapsibleTrigger>
  )
}

export type SandboxContentProps = ComponentProps<typeof CollapsibleContent>

export function SandboxContent({
  className,
  ...props
}: SandboxContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        'data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-2 data-[state=open]:slide-in-from-top-2 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in',
        className,
      )}
      {...props}
    />
  )
}

export type SandboxTabsProps = ComponentProps<typeof Tabs>

export function SandboxTabs({ className, ...props }: SandboxTabsProps) {
  return <Tabs className={cn('w-full gap-0', className)} {...props} />
}

export type SandboxTabsBarProps = ComponentProps<'div'>

export function SandboxTabsBar({
  className,
  ...props
}: SandboxTabsBarProps) {
  return (
    <div
      className={cn(
        'flex w-full items-center border-border border-t border-b',
        className,
      )}
      {...props}
    />
  )
}

export type SandboxTabsListProps = ComponentProps<typeof TabsList>

export function SandboxTabsList({
  className,
  ...props
}: SandboxTabsListProps) {
  return (
    <TabsList
      className={cn('h-auto rounded-none border-0 bg-transparent p-0', className)}
      {...props}
    />
  )
}

export type SandboxTabsTriggerProps = ComponentProps<typeof TabsTrigger>

export function SandboxTabsTrigger({
  className,
  ...props
}: SandboxTabsTriggerProps) {
  return (
    <TabsTrigger
      className={cn(
        'rounded-none border-0 border-transparent border-b-2 px-4 py-2 font-medium text-muted-foreground text-sm transition-colors data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none',
        className,
      )}
      {...props}
    />
  )
}

export type SandboxTabContentProps = ComponentProps<typeof TabsContent>

export function SandboxTabContent({
  className,
  ...props
}: SandboxTabContentProps) {
  return <TabsContent className={cn('mt-0 text-sm', className)} {...props} />
}
