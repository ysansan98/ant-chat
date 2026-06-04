import { describe, expect, it } from 'vitest'
import { parseBuiltinCommand } from '../builtinCommandParser'

describe('parseBuiltinCommand', () => {
  it('正确解析 /compact 带参数', () => {
    expect(parseBuiltinCommand('/compact keep database schema', [], undefined)).toEqual({
      id: 'compact',
      argument: 'keep database schema',
    })
  })

  it('正确解析 /compact 不带参数', () => {
    expect(parseBuiltinCommand('/compact', [], undefined)).toEqual({
      id: 'compact',
      argument: undefined,
    })
  })

  it('正确解析 /compact 多行参数', () => {
    expect(parseBuiltinCommand('/compact line1\nline2\nline3', [], undefined)).toEqual({
      id: 'compact',
      argument: 'line1\nline2\nline3',
    })
  })

  it('正确解析 /new', () => {
    expect(parseBuiltinCommand('/new', [], undefined)).toEqual({ id: 'new' })
  })

  it('正确解析 /fork', () => {
    expect(parseBuiltinCommand('/fork', [], undefined)).toEqual({ id: 'fork' })
  })

  it('拒绝 /new 带参数', () => {
    expect(() => parseBuiltinCommand('/new something', [], undefined)).toThrow('/new does not accept arguments')
  })

  it('拒绝 /fork 带参数', () => {
    expect(() => parseBuiltinCommand('/fork something', [], undefined)).toThrow('/fork does not accept arguments')
  })

  it('拒绝与 @file 引用混合', () => {
    expect(() => parseBuiltinCommand('/compact keep db', ['src/a.ts'], undefined)).toThrow('@file references')
  })

  it('拒绝与 skill 引用混合', () => {
    expect(() => parseBuiltinCommand('/compact test', [], 'other-skill')).toThrow('skill /other-skill')
  })

  it('非内置指令返回 null', () => {
    expect(parseBuiltinCommand('/some-skill', [], undefined)).toBeNull()
    expect(parseBuiltinCommand('普通文本', [], undefined)).toBeNull()
    expect(parseBuiltinCommand('', [], undefined)).toBeNull()
  })

  it('/ 开头的未知命令返回 null', () => {
    expect(parseBuiltinCommand('/unknown', [], undefined)).toBeNull()
  })
})
