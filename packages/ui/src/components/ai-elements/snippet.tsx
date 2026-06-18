'use client'

import type { ComponentProps } from 'react'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@workspace/ui/components/input-group'
import { writeClipboardText } from '@workspace/ui/lib/clipboard'
import { cn } from '@workspace/ui/lib/utils'
import { CheckIcon, CopyIcon } from 'lucide-react'
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

interface SnippetContextType {
  code: string
}

const SnippetContext = createContext<SnippetContextType>({
  code: '',
})

export type SnippetProps = ComponentProps<typeof InputGroup> & {
  code: string
}

export function Snippet({
  code,
  className,
  children,
  ...props
}: SnippetProps) {
  const contextValue = useMemo(() => ({ code }), [code])

  return (
    <SnippetContext value={contextValue}>
      <InputGroup className={cn('font-mono', className)} {...props}>
        {children}
      </InputGroup>
    </SnippetContext>
  )
}

export type SnippetAddonProps = ComponentProps<typeof InputGroupAddon>

export function SnippetAddon(props: SnippetAddonProps) {
  return <InputGroupAddon {...props} />
}

export type SnippetTextProps = ComponentProps<typeof InputGroupText>

export function SnippetText({ className, ...props }: SnippetTextProps) {
  return (
    <InputGroupText
      className={cn('pl-2 font-normal text-muted-foreground', className)}
      {...props}
    />
  )
}

export type SnippetInputProps = Omit<
  ComponentProps<typeof InputGroupInput>,
  'readOnly' | 'value'
>

export function SnippetInput({ className, ...props }: SnippetInputProps) {
  const { code } = use(SnippetContext)

  return (
    <InputGroupInput
      className={cn('text-foreground', className)}
      readOnly
      value={code}
      {...props}
    />
  )
}

export type SnippetCopyButtonProps = ComponentProps<typeof InputGroupButton> & {
  onCopy?: () => void
  onError?: (error: Error) => void
  timeout?: number
}

export function SnippetCopyButton({
  onCopy,
  onError,
  timeout = 2000,
  children,
  className,
  ...props
}: SnippetCopyButtonProps) {
  const [isCopied, setIsCopied] = useState(false)
  const timeoutRef = useRef<number>(0)
  const { code } = use(SnippetContext)

  const copyToClipboard = useCallback(async () => {
    try {
      if (!isCopied) {
        await writeClipboardText(code)
        setIsCopied(true)
        onCopy?.()
        timeoutRef.current = window.setTimeout(
          () => setIsCopied(false),
          timeout,
        )
      }
    }
    catch (error) {
      onError?.(error as Error)
    }
  }, [code, onCopy, onError, timeout, isCopied])

  useEffect(
    () => () => {
      window.clearTimeout(timeoutRef.current)
    },
    [],
  )

  const Icon = isCopied ? CheckIcon : CopyIcon

  return (
    <InputGroupButton
      aria-label="Copy"
      className={className}
      onClick={copyToClipboard}
      size="icon-sm"
      title="Copy"
      {...props}
    >
      {children ?? <Icon className="size-3.5" size={14} />}
    </InputGroupButton>
  )
}
