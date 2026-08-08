import { describe, expect, it } from 'vitest'
import { parseChannelInput } from '../channelCommandParser'

describe('频道命令解析', () => {
  it('把普通文本和控制命令分开', () => {
    expect(parseChannelInput('请检查这个项目')).toEqual({ kind: 'text', text: '请检查这个项目' })
    expect(parseChannelInput('/models')).toEqual({ kind: 'command', command: { id: 'models' } })
    expect(parseChannelInput('/mode')).toEqual({ kind: 'command', command: { id: 'mode' } })
    expect(parseChannelInput('/mode 完全访问权限')).toEqual({ kind: 'command', command: { id: 'mode', query: '完全访问权限' } })
  })

  it('保留 /new 后包含空格的完整路径', () => {
    expect(parseChannelInput('/new /Users/me/My Project')).toEqual({ kind: 'command', command: { id: 'new', path: '/Users/me/My Project' } })
  })

  it('未知命令和缺少参数返回用户可读错误，不降级成普通文本', () => {
    expect(parseChannelInput('/unknown value')).toEqual({ kind: 'error', message: expect.stringContaining('/help') })
    expect(parseChannelInput('/model')).toEqual({ kind: 'error', message: '用法：/model <名称或序号>' })
  })
})
