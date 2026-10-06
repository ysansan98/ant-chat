import type { BackgroundCommandStatus, BackgroundCommandSummary } from '@ant-chat/shared'
import { Button } from '@workspace/ui/components/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@workspace/ui/components/hover-card'
import { cn } from '@workspace/ui/lib/utils'
import { OctagonXIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import agentApi from '@/api/agentApi'
import { killBackgroundCommandAction, useAgentRuntimeStore } from '@/store/agentRuntime'

const COLLAPSED_LIMIT = 5
const EMPTY_COMMANDS: BackgroundCommandSummary[] = []

const STATUS_LABEL: Record<BackgroundCommandStatus, string> = {
  running: '运行中',
  exited: '已结束',
  killed: '已终止',
}

interface BackgroundCommandPanelProps {
  conversationId: string
}

/**
 * 会话级后台命令面板：位于输入卡片上方，无运行中命令时不占位。
 *
 * 只展示运行中的命令：进程结束或被终止即从面板移除（终态已无可操作动作）；
 * 最终状态仍可在 TurnTrace 徽标中查看，日志文件保留在磁盘。
 * 横向胶囊组，hover 胶囊在上方弹出日志与终止操作。
 */
export function BackgroundCommandPanel({ conversationId }: BackgroundCommandPanelProps) {
  const commands = useAgentRuntimeStore(state => state.backgroundCommandsByConversation[conversationId] ?? EMPTY_COMMANDS)
  const [expanded, setExpanded] = useState(false)

  const runningCommands = useMemo(
    () => commands.filter(command => command.status === 'running'),
    [commands],
  )

  if (runningCommands.length === 0)
    return null

  const visible = expanded ? runningCommands : runningCommands.slice(0, COLLAPSED_LIMIT)
  const hidden = runningCommands.length - visible.length

  return (
    <div aria-label="后台命令" className="flex flex-wrap items-center gap-1 px-2 py-1">
      {visible.map(command => (
        <BackgroundCommandCapsule command={command} conversationId={conversationId} key={command.commandId} />
      ))}
      {hidden > 0 && (
        <Button
          className="h-6 rounded-full px-2 text-xs"
          size="sm"
          variant="ghost"
          onClick={() => setExpanded(true)}
        >
          +
          {hidden}
        </Button>
      )}
    </div>
  )
}

function BackgroundCommandCapsule({ conversationId, command }: { conversationId: string, command: BackgroundCommandSummary }) {
  const [open, setOpen] = useState(false)
  const running = command.status === 'running'
  const label = command.description?.trim() || command.command
  const log = useCommandLog(conversationId, command.commandId, open, running)

  return (
    <HoverCard open={open} onOpenChange={setOpen}>
      <div className="group relative inline-flex">
        <HoverCardTrigger
          render={(
            <button
              className={cn(
                'flex h-6 max-w-56 items-center gap-1.5 rounded-full border px-2 text-xs transition-colors',
                running
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
                  : 'border-border bg-muted/40 text-muted-foreground',
              )}
              type="button"
              onClick={() => setOpen(value => !value)}
            >
              <StatusDot status={command.status} />
              <span className="truncate">{label}</span>
              {!running && command.exitCode !== undefined && (
                <span className="tabular-nums opacity-70">{command.exitCode}</span>
              )}
            </button>
          )}
        />
        {/* 终止入口：hover 时浮现并覆盖胶囊右侧，绝对定位不撑开胶囊宽度 */}
        {running && (
          <button
            aria-label={`终止：${label}`}
            className="
              pointer-events-none absolute inset-y-0 right-1 my-auto flex size-5 items-center
              justify-center rounded-full bg-emerald-100 text-emerald-700 opacity-0
              ring-1 ring-emerald-500/30 transition-[opacity,background-color]
              group-hover:pointer-events-auto group-hover:opacity-100
              hover:bg-emerald-200
              focus-visible:pointer-events-auto focus-visible:opacity-100
              dark:bg-emerald-900 dark:text-emerald-400 dark:hover:bg-emerald-800
            "
            type="button"
            onClick={async () => {
              await killBackgroundCommandAction(conversationId, command.commandId)
              setOpen(false)
            }}
          >
            <OctagonXIcon className="size-3.5" />
          </button>
        )}
      </div>
      <HoverCardContent align="start" className="w-96 max-w-[calc(100vw-2rem)] space-y-2" side="top">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusDot status={command.status} />
            <span>{STATUS_LABEL[command.status]}</span>
            {command.pid !== undefined && (
              <span className="tabular-nums">
                pid
                {command.pid}
              </span>
            )}
            <span>{formatDuration(command)}</span>
            {!running && command.exitCode !== undefined && (
              <span className="tabular-nums">
                exit
                {command.exitCode}
              </span>
            )}
          </div>
          <p className="font-mono text-xs break-all">{command.command}</p>
          <p className="text-[11px] break-all text-muted-foreground">
            cwd:
            {command.cwd}
          </p>
          {command.hasSecretEnv && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">
              该后台进程持有 Turn 密钥：
              {command.secretEnvKeys.join(', ')}
            </p>
          )}
          {command.truncated && (
            <p className="text-[11px] text-amber-600 dark:text-amber-400">日志已达大小上限，之后不再增长</p>
          )}
        </div>
        <pre className="max-h-52 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] break-all whitespace-pre-wrap">
          {log || '(暂无输出)'}
        </pre>
      </HoverCardContent>
    </HoverCard>
  )
}

function StatusDot({ status }: { status: BackgroundCommandStatus }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.5 shrink-0 rounded-full',
        status === 'running' && 'animate-pulse bg-emerald-500',
        status === 'exited' && 'bg-muted-foreground/50',
        status === 'killed' && 'bg-destructive',
      )}
    />
  )
}

/** 面板打开时读取日志尾部；进程仍运行则每秒刷新。 */
function useCommandLog(conversationId: string, commandId: string, active: boolean, running: boolean): string {
  const [text, setText] = useState('')
  useEffect(() => {
    if (!active)
      return
    let cancelled = false
    const load = async () => {
      try {
        const result = await agentApi.readBackgroundCommandOutput(conversationId, commandId, { tail: 8192 })
        if (!cancelled)
          setText(result.text)
      }
      catch {
        // 读取失败保持上一次内容
      }
    }
    void load()
    if (!running) {
      return () => {
        cancelled = true
      }
    }
    const timer = setInterval(() => {
      void load()
    }, 1000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [conversationId, commandId, active, running])
  return text
}

function formatDuration(command: BackgroundCommandSummary): string {
  const end = command.endedAt ?? Date.now()
  const ms = Math.max(0, end - command.startedAt)
  if (ms < 1000)
    return `${ms}ms`
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60)
    return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60)
    return `${minutes}m${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h${minutes % 60}m`
}
