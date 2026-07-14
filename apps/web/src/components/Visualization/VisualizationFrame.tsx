import type { FrameToHost, VisualizationBlockLike, VisualizationSpec } from './types'
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { submitVisualizationFollowUp } from '@/store/pendingMessages'
import {
  clampFrameHeight,
  getVisualizationTheme,
  loadVisualizationArtifact,
  validateFollowUpRequest,
} from './bridge'
import { createVisualizationSandboxDocument } from './sandboxDocument'
import { getVisualizationArtifactId } from './types'

export interface VisualizationFollowUpRequest {
  spec: VisualizationSpec
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
    | { status: 'ready', spec: VisualizationSpec }
    | { status: 'error', message: string }

export function VisualizationFrame({ block, conversationId, messageId, onFollowUpRequest, className }: VisualizationFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const portRef = useRef<MessagePort | null>(null)
  const transferPortRef = useRef<MessagePort | null>(null)
  const specRef = useRef<VisualizationSpec | null>(null)
  const callbackRef = useRef(onFollowUpRequest)
  const sandboxDocument = useMemo(() => createVisualizationSandboxDocument(), [])
  const [state, setState] = useState<FrameState>({ status: 'loading' })
  const [height, setHeight] = useState(240)
  const [confirmation, setConfirmation] = useState<{ text: string, request: Extract<FrameToHost, { type: 'follow-up-request' }> } | null>(null)

  useEffect(() => {
    callbackRef.current = onFollowUpRequest
  }, [onFollowUpRequest])

  const handleFrameLoad = useCallback(() => {
    const transferPort = transferPortRef.current
    const frame = iframeRef.current
    if (!transferPort || !frame?.contentWindow)
      return
    transferPortRef.current = null
    frame.contentWindow.postMessage({ type: 'visualization-connect' }, '*', [transferPort])
  }, [])

  useEffect(() => {
    let disposed = false
    let connectSent = false
    let resizeFrame: number | undefined
    let resizeTimeout: number | undefined
    let portMessageHandler: ((event: MessageEvent) => void) | undefined
    let pendingHeight = 240
    const channel = typeof MessageChannel === 'undefined' ? null : new MessageChannel()
    portRef.current = channel?.port1 ?? null
    transferPortRef.current = channel?.port2 ?? null
    const frame = iframeRef.current
    const artifactId = getVisualizationArtifactId(block)

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
        return
      }
      resizeTimeout = window.setTimeout(() => {
        resizeTimeout = undefined
        if (!disposed)
          setHeight(pendingHeight)
      }, 0)
    }

    const connect = () => {
      if (disposed || connectSent || !channel || !transferPortRef.current || !frame?.contentWindow)
        return
      connectSent = true
      const transferPort = transferPortRef.current
      transferPortRef.current = null
      frame.contentWindow.postMessage({ type: 'visualization-connect' }, '*', [transferPort])
    }

    const load = async () => {
      try {
        const artifact = await loadVisualizationArtifact(
          block,
          conversationId && messageId ? { conversationId, messageId } : undefined,
        )
        if (disposed)
          return
        specRef.current = artifact.spec
        setState({ status: 'ready', spec: artifact.spec })
        portMessageHandler = (event: MessageEvent) => {
          const parsedMessage = FrameToHostMessageSchema.safeParse(event.data)
          if (!parsedMessage.success)
            return
          const message = parsedMessage.data
          if (message.type === 'ready') {
            channel?.port1.postMessage({
              type: 'init',
              artifactId,
              spec: artifact.spec,
              theme: getVisualizationTheme(),
            })
            return
          }
          if (message.type === 'resize') {
            scheduleHeight(message.height)
            return
          }
          if (message.type === 'follow-up-request' && validateFollowUpRequest(artifact.spec, message, artifactId)) {
            const callback = callbackRef.current
            if (callback) {
              Promise.resolve(callback({ spec: artifact.spec, request: message })).then((accepted) => {
                if (!disposed)
                  channel?.port1.postMessage({ type: 'follow-up-result', requestId: message.requestId, accepted: Boolean(accepted) })
              })
            }
            else {
              setConfirmation({ text: buildFollowUpPrompt(artifact.spec, message), request: message })
            }
          }
        }
        channel?.port1.addEventListener('message', portMessageHandler)
        channel?.port1.start()
        connect()
      }
      catch (error) {
        if (!disposed)
          setState({ status: 'error', message: error instanceof Error ? error.message : '可视化 artifact 无法加载' })
      }
    }

    void load()
    const connectTimer = window.setTimeout(connect, 0)
    const observer = typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver(() => {
          channel?.port1.postMessage({ type: 'theme', theme: getVisualizationTheme() })
        })
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })

    return () => {
      disposed = true
      window.clearTimeout(connectTimer)
      if (resizeTimeout != null)
        window.clearTimeout(resizeTimeout)
      observer?.disconnect()
      if (resizeFrame != null && typeof cancelAnimationFrame === 'function')
        cancelAnimationFrame(resizeFrame)
      if (portMessageHandler)
        channel?.port1.removeEventListener('message', portMessageHandler)
      channel?.port1.close()
      channel?.port2.close()
      portRef.current = null
      transferPortRef.current = null
      specRef.current = null
    }
  }, [block, conversationId, messageId])

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
          onLoad={handleFrameLoad}
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
            <AlertDialogTitle>确认发送下一轮消息</AlertDialogTitle>
            <AlertDialogDescription className="wrap-break-word whitespace-pre-wrap">{confirmation?.text}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault()
                const current = confirmation
                if (!current || !conversationId)
                  return
                void submitVisualizationFollowUp(conversationId, current.text).then(() => {
                  portRef.current?.postMessage({ type: 'follow-up-result', requestId: current.request.requestId, accepted: true })
                  setConfirmation(null)
                }).catch(() => {
                  portRef.current?.postMessage({ type: 'follow-up-result', requestId: current.request.requestId, accepted: false })
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

function buildFollowUpPrompt(spec: VisualizationSpec, request: Extract<FrameToHost, { type: 'follow-up-request' }>): string {
  const action = spec.actions?.find(candidate => candidate.id === request.actionId)
  if (!action)
    return ''
  return action.prompt.map((part) => {
    if (part.type === 'text')
      return part.text
    const value = request.values[part.fieldId]
    return value === null || value === undefined ? '' : String(value)
  }).join('')
}
