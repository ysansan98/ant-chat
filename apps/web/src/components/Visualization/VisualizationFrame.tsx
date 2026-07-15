import type { FrameToHost, VisualizationBlockLike } from './types'
import { FrameToHostMessageSchema } from '@ant-chat/shared'
import { Alert, AlertDescription, AlertTitle } from '@workspace/ui/components/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/alert-dialog'
import { cn } from '@workspace/ui/lib/utils'
import { Loader2Icon, ShieldAlertIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { submitVisualizationFollowUp } from '@/store/pendingMessages'
import { clampFrameHeight, getInitialFrameHeight, getVisualizationTheme, loadVisualizationArtifact, validateFollowUpRequest } from './bridge'
import { createVisualizationSandboxDocument } from './sandboxDocument'
import { getVisualizationArtifactId } from './types'

export interface VisualizationFollowUpRequest {
  request: Extract<FrameToHost, { type: 'follow-up-request' }>
}

interface VisualizationFrameProps {
  block: VisualizationBlockLike
  conversationId?: string
  messageId?: string
  onFollowUpRequest?: (request: VisualizationFollowUpRequest) => boolean | Promise<boolean>
  className?: string
}

type FrameState
  = | { status: 'loading' }
    | { status: 'ready', html: string }
    | { status: 'error', message: string }

export function VisualizationFrame({ block, conversationId, messageId, onFollowUpRequest, className }: VisualizationFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const portRef = useRef<MessagePort | null>(null)
  const transferPortRef = useRef<MessagePort | null>(null)
  const callbackRef = useRef(onFollowUpRequest)
  const [state, setState] = useState<FrameState>({ status: 'loading' })
  const [height, setHeight] = useState(getInitialFrameHeight)
  const [confirmation, setConfirmation] = useState<Extract<FrameToHost, { type: 'follow-up-request' }> | null>(null)

  useEffect(() => {
    callbackRef.current = onFollowUpRequest
  }, [onFollowUpRequest])

  useEffect(() => {
    let disposed = false
    const load = async () => {
      try {
        const artifact = await loadVisualizationArtifact(
          block,
          conversationId && messageId ? { conversationId, messageId } : undefined,
        )
        if (!disposed)
          setState({ status: 'ready', html: artifact.html })
      }
      catch (error) {
        if (!disposed)
          setState({ status: 'error', message: error instanceof Error ? error.message : '可视化 artifact 无法加载' })
      }
    }
    setState({ status: 'loading' })
    void load()
    return () => {
      disposed = true
    }
  }, [block, conversationId, messageId])

  const sandboxDocument = useMemo(
    () => state.status === 'ready' ? createVisualizationSandboxDocument(state.html) : '',
    [state],
  )

  useEffect(() => {
    if (state.status !== 'ready')
      return

    // MessagePort 是 iframe 的唯一宿主通道；这里同时绑定 artifact id、主题和 resize 生命周期，避免 fragment 获得 app RPC 或绕过确认直接发消息。
    let disposed = false
    let resizeFrame: number | undefined
    let resizeTimeout: number | undefined
    let pendingHeight = getInitialFrameHeight()
    const channel = typeof MessageChannel === 'undefined' ? null : new MessageChannel()
    const artifactId = getVisualizationArtifactId(block)
    portRef.current = channel?.port1 ?? null
    transferPortRef.current = channel?.port2 ?? null

    const scheduleHeight = (nextHeight: number) => {
      pendingHeight = clampFrameHeight(nextHeight)
      if (resizeFrame != null)
        return
      if (typeof requestAnimationFrame === 'function') {
        resizeFrame = requestAnimationFrame(() => {
          resizeFrame = undefined
          if (!disposed)
            setHeight(pendingHeight)
        })
      }
      else {
        resizeTimeout = window.setTimeout(() => {
          resizeTimeout = undefined
          if (!disposed)
            setHeight(pendingHeight)
        }, 0)
      }
    }

    const portMessageHandler = (event: MessageEvent) => {
      const parsed = FrameToHostMessageSchema.safeParse(event.data)
      if (!parsed.success)
        return
      const message = parsed.data
      if (message.type === 'ready') {
        channel?.port1.postMessage({ type: 'init', artifactId, theme: getVisualizationTheme() })
      }
      else if (message.type === 'resize') {
        scheduleHeight(message.height)
      }
      else if (message.type === 'follow-up-request' && validateFollowUpRequest(message, artifactId)) {
        const callback = callbackRef.current
        if (callback) {
          Promise.resolve(callback({ request: message })).then((accepted) => {
            if (!disposed)
              channel?.port1.postMessage({ type: 'follow-up-result', requestId: message.requestId, accepted: Boolean(accepted) })
          })
        }
        else {
          setConfirmation(message)
        }
      }
    }

    channel?.port1.addEventListener('message', portMessageHandler)
    channel?.port1.start()
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => channel?.port1.postMessage({ type: 'theme', theme: getVisualizationTheme() }))
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })

    return () => {
      disposed = true
      if (resizeTimeout != null)
        window.clearTimeout(resizeTimeout)
      observer?.disconnect()
      if (resizeFrame != null && typeof cancelAnimationFrame === 'function')
        cancelAnimationFrame(resizeFrame)
      channel?.port1.removeEventListener('message', portMessageHandler)
      channel?.port1.close()
      channel?.port2.close()
      portRef.current = null
      transferPortRef.current = null
    }
  }, [block, state, conversationId, messageId])

  if (state.status === 'loading') {
    return (
      <div className={cn('flex min-h-24 items-center gap-2 text-sm text-muted-foreground', className)} role="status">
        <Loader2Icon className="size-4 animate-spin" />
        正在加载可视化
      </div>
    )
  }
  if (state.status === 'error') {
    return (
      <Alert variant="destructive" className={className} data-visualization-state="error">
        <ShieldAlertIcon className="size-4" />
        <AlertTitle>可视化无法显示</AlertTitle>
        <AlertDescription>{state.message}</AlertDescription>
      </Alert>
    )
  }

  return (
    <>
      <div className={cn('w-full overflow-hidden rounded-xl bg-card/40 ring-1 ring-border/60', className)} data-visualization-state="ready">
        <iframe
          ref={iframeRef}
          title={block.title}
          aria-label={block.summary || block.title}
          className="block w-full border-0"
          style={{ height: `${height}px` }}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={sandboxDocument}
          onLoad={() => {
            const port = transferPortRef.current
            if (port && iframeRef.current?.contentWindow) {
              transferPortRef.current = null
              iframeRef.current.contentWindow.postMessage({ type: 'visualization-connect' }, '*', [port])
            }
          }}
        />
      </div>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open)
            setConfirmation(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title || '确认发送下一轮消息'}</AlertDialogTitle>
            <AlertDialogDescription className="wrap-break-word whitespace-pre-wrap">{confirmation?.prompt}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => {
              event.preventDefault()
              const current = confirmation
              if (!current || !conversationId)
                return
              void submitVisualizationFollowUp(conversationId, current.prompt).then(() => {
                portRef.current?.postMessage({ type: 'follow-up-result', requestId: current.requestId, accepted: true })
                setConfirmation(null)
              }).catch(() => {
                portRef.current?.postMessage({ type: 'follow-up-result', requestId: current.requestId, accepted: false })
              })
            }}
            >
              确认发送
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
