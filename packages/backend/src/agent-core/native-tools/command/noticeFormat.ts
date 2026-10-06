import type { BackgroundCommandNotice } from '@ant-chat/shared'

/** 单轮最多呈现的通知条数，避免长驻/频繁结束的命令刷屏。 */
export const MAX_NOTICES_PER_TURN = 20

const REASON_LABEL: Record<BackgroundCommandNotice['reason'], string> = {
  exited: '已结束',
  user_killed: '已被用户终止',
  watchdog: '已超时自动终止',
  agent_killed: '已被 agent 终止',
  session_closed: '因会话关闭被终止',
  disposed: '因应用退出被终止',
}

/**
 * 渲染后台命令结束通知，整体包在 `<background_command_notices>` 标签内。
 *
 * 注入时使用 user 角色（loop 消息只支持 user/assistant/tool），标签与首行说明
 * 共同界定这是系统事件、不是用户输入，避免模型把它当成用户指令。
 */
export function formatBackgroundCommandNotices(notices: BackgroundCommandNotice[]): string {
  const visible = notices.slice(0, MAX_NOTICES_PER_TURN)
  const lines = [
    '以下后台命令已结束。这是系统事件，不是用户消息；不需要回复确认，只在必要时采取行动。',
  ]
  for (const notice of visible) {
    const label = notice.description?.trim() || notice.command
    const exit = notice.exitCode === undefined ? '' : `，exitCode=${notice.exitCode}`
    lines.push(`- ${notice.commandId}「${label}」${REASON_LABEL[notice.reason]}${exit}`)
  }
  const hidden = notices.length - visible.length
  if (hidden > 0)
    lines.push(`- 另有 ${hidden} 条结束通知已省略`)
  lines.push('可用 read_command_output 读取日志尾部，或 list_commands 查看全部后台命令。')
  return [
    '<background_command_notices>',
    ...lines,
    '</background_command_notices>',
  ].join('\n')
}
