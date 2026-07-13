import { describe, expect, it } from 'vitest'
import { hasSkillReference, parseBuiltinCommand } from '../builtinCommandParser'

describe('parseBuiltinCommand', () => {
  it('正确解析 /compact 带参数', () => {
    expect(parseBuiltinCommand('/compact keep database schema')).toEqual({
      id: 'compact',
      argument: 'keep database schema',
    })
  })

  it('正确解析 /compact 不带参数', () => {
    expect(parseBuiltinCommand('/compact')).toEqual({
      id: 'compact',
      argument: undefined,
    })
  })

  it('正确解析 /compact 多行参数', () => {
    expect(parseBuiltinCommand('/compact line1\nline2\nline3')).toEqual({
      id: 'compact',
      argument: 'line1\nline2\nline3',
    })
  })

  it('正确解析 /new', () => {
    expect(parseBuiltinCommand('/new')).toEqual({ id: 'new' })
  })

  it('正确解析 /fork', () => {
    expect(parseBuiltinCommand('/fork')).toEqual({ id: 'fork' })
  })

  it('拒绝 /new 带参数', () => {
    expect(() => parseBuiltinCommand('/new something')).toThrow('/new does not accept arguments')
  })

  it('拒绝 /fork 带参数', () => {
    expect(() => parseBuiltinCommand('/fork something')).toThrow('/fork does not accept arguments')
  })

  it('拒绝与 @file 引用混合', () => {
    expect(() => parseBuiltinCommand('/compact keep db @src/a.ts')).toThrow('@file references')
  })

  it('拒绝与 skill 引用混合', () => {
    expect(() => parseBuiltinCommand('/compact /other-skill test', new Set(['other-skill']))).toThrow('skill /other-skill')
  })

  it('不把参数正文中的 slash 路径或 token 当成 Skill', () => {
    expect(parseBuiltinCommand('/compact 请检查 /tmp')).toEqual({
      id: 'compact',
      argument: '请检查 /tmp',
    })
    expect(parseBuiltinCommand('/compact test /writer')).toEqual({
      id: 'compact',
      argument: 'test /writer',
    })
    expect(parseBuiltinCommand('/compact /tmp', new Set(['writer']))).toEqual({
      id: 'compact',
      argument: '/tmp',
    })
  })

  it('非内置指令返回 null', () => {
    expect(parseBuiltinCommand('/some-skill')).toBeNull()
    expect(parseBuiltinCommand('普通文本')).toBeNull()
    expect(parseBuiltinCommand('')).toBeNull()
  })

  it('/ 开头的未知命令返回 null', () => {
    expect(parseBuiltinCommand('/unknown')).toBeNull()
  })

  it('区分 Skill 引用和内置指令', () => {
    const knownSkillNames = new Set(['review', 'writer'])
    expect(hasSkillReference('/review', knownSkillNames)).toBe(true)
    expect(hasSkillReference('/writer 处理', knownSkillNames)).toBe(true)
    expect(hasSkillReference('使用 /writer 处理', knownSkillNames)).toBe(false)
    expect(hasSkillReference('/compact', knownSkillNames)).toBe(false)
    expect(hasSkillReference('/tmp', knownSkillNames)).toBe(false)
  })
})
