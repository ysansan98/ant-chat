import type { BackgroundCommandNotice } from '@ant-chat/shared'
import { describe, expect, it } from 'vitest'
import { formatBackgroundCommandNotices, MAX_NOTICES_PER_TURN } from '../noticeFormat'

function notice(overrides: Partial<BackgroundCommandNotice> = {}): BackgroundCommandNotice {
  return {
    commandId: 'cmd-1',
    command: 'pnpm dev',
    description: '启动开发服务',
    status: 'exited',
    exitCode: 0,
    reason: 'exited',
    startedAt: 1,
    endedAt: 2,
    ...overrides,
  }
}

describe('后台命令结束通知文案', () => {
  it('整体包在标签内，标注系统事件并提供后续动作提示', () => {
    const text = formatBackgroundCommandNotices([notice()])
    expect(text.startsWith('<background_command_notices>')).toBe(true)
    expect(text.endsWith('</background_command_notices>')).toBe(true)
    expect(text).toContain('不是用户消息')
    expect(text).toContain('cmd-1「启动开发服务」已结束，exitCode=0')
    expect(text).toContain('read_command_output')
  })

  it('区分用户终止与看门狗超时，缺省 description 时回退命令本体', () => {
    const text = formatBackgroundCommandNotices([
      notice({ commandId: 'cmd-2', description: undefined, command: 'pnpm dev', reason: 'user_killed', status: 'killed', exitCode: undefined }),
      notice({ commandId: 'cmd-3', reason: 'watchdog', status: 'killed', exitCode: undefined }),
    ])
    expect(text).toContain('cmd-2「pnpm dev」已被用户终止')
    expect(text).toContain('cmd-3「启动开发服务」已超时自动终止')
    expect(text).not.toContain('exitCode')
  })

  it('超过单轮上限时省略多余条目', () => {
    const notices = Array.from({ length: MAX_NOTICES_PER_TURN + 3 }, (_, index) =>
      notice({ commandId: `cmd-${index}` }))
    const text = formatBackgroundCommandNotices(notices)
    expect(text).toContain('另有 3 条结束通知已省略')
  })
})
