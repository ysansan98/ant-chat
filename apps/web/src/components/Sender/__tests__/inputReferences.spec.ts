import { describe, expect, it } from 'vitest'
import {
  buildReferenceInputParts,
  getActiveReferenceTrigger,
  insertReferenceToken,
  isCompletedReferenceTrigger,
  moveCursorAcrossReferenceToken,
  removeReferenceTokenAtCursor,
  snapCursorToReferenceTokenBoundary,
  syncConfirmedFileReferences,
  syncConfirmedSkillReference,
} from '../inputReferences'

describe('inputReferences', () => {
  it('识别当前光标前的 @ 或 / trigger', () => {
    expect(getActiveReferenceTrigger('分析 @src', 7)).toEqual({
      type: 'file',
      query: 'src',
      start: 3,
      end: 7,
    })
    expect(getActiveReferenceTrigger('/code', 5)).toMatchObject({
      type: 'skill',
      query: 'code',
      start: 0,
      end: 5,
    })
  })

  it('选择候选后替换 trigger token', () => {
    const trigger = getActiveReferenceTrigger('分析 @sr', 6)!
    expect(insertReferenceToken('分析 @sr', trigger, '@src/a.ts')).toEqual({
      text: '分析 @src/a.ts ',
      cursor: 13,
    })
  })

  it('根据输入文本同步已选上下文', () => {
    expect(syncConfirmedFileReferences('看 @src/a.ts', ['src/a.ts', 'src/b.ts'])).toEqual(['src/a.ts'])
    expect(syncConfirmedSkillReference('用 /writer 写', 'writer')).toBe('writer')
    expect(syncConfirmedSkillReference('用 writer 写', 'writer')).toBeUndefined()
    expect(syncConfirmedFileReferences('看 @src/a.tsx', ['src/a.ts'])).toEqual([])
    expect(syncConfirmedSkillReference('用 /writer-pro 写', 'writer')).toBeUndefined()
  })

  it('已选引用 token 不再作为 active trigger', () => {
    const trigger = getActiveReferenceTrigger('@resume.md', '@resume.md'.length)
    expect(isCompletedReferenceTrigger(trigger, ['resume.md'])).toBe(true)
    expect(isCompletedReferenceTrigger(trigger, ['other.md'])).toBe(false)
  })

  it('backspace/delete 将引用 token 作为整体删除', () => {
    expect(removeReferenceTokenAtCursor('看 @resume.md 后续', 7, 'Backspace', ['resume.md'])).toEqual({
      text: '看 后续',
      cursor: 2,
    })
    expect(removeReferenceTokenAtCursor('看 @resume.md 后续', 2, 'Delete', ['resume.md'])).toEqual({
      text: '看 后续',
      cursor: 2,
    })
    expect(removeReferenceTokenAtCursor('/writer 继续', 8, 'Backspace', [], 'writer')).toEqual({
      text: '继续',
      cursor: 0,
    })
  })

  it('左右方向键跳过引用 token', () => {
    expect(moveCursorAcrossReferenceToken('看 @resume.md 后续', 7, 'ArrowLeft', ['resume.md'])).toBe(2)
    expect(moveCursorAcrossReferenceToken('看 @resume.md 后续', 3, 'ArrowRight', ['resume.md'])).toBe(13)
    expect(moveCursorAcrossReferenceToken('看 @resume.md 后续', 0, 'ArrowRight', ['resume.md'])).toBeNull()
  })

  it('点击到引用 token 中间时吸附到边界', () => {
    expect(snapCursorToReferenceTokenBoundary('看 @resume.md 后续', 7, ['resume.md'])).toBe(13)
    expect(snapCursorToReferenceTokenBoundary('看 @resume.md 后续', 4, ['resume.md'])).toBe(2)
  })

  it('为 overlay 拆分已确认引用 token', () => {
    expect(buildReferenceInputParts('看 @resume.md 和 @notes.md /writer 后续', ['resume.md', 'notes.md'], 'writer')).toEqual([
      { type: 'text', text: '看 ', offset: 0 },
      { type: 'file', text: '@resume.md', offset: 2 },
      { type: 'text', text: ' 和 ', offset: 12 },
      { type: 'file', text: '@notes.md', offset: 15 },
      { type: 'text', text: ' ', offset: 24 },
      { type: 'skill', text: '/writer', offset: 25 },
      { type: 'text', text: ' 后续', offset: 32 },
    ])
  })

  it('overlay 不高亮未确认或非独立 token', () => {
    expect(buildReferenceInputParts('看 @resume.md @draft.md @resume.mdx', ['resume.md'])).toEqual([
      { type: 'text', text: '看 ', offset: 0 },
      { type: 'file', text: '@resume.md', offset: 2 },
      { type: 'text', text: ' @draft.md @resume.mdx', offset: 12 },
    ])
  })

  it('overlay 支持重复引用同一个 token', () => {
    expect(buildReferenceInputParts('@resume.md 再看 @resume.md', ['resume.md'])).toEqual([
      { type: 'file', text: '@resume.md', offset: 0 },
      { type: 'text', text: ' 再看 ', offset: 10 },
      { type: 'file', text: '@resume.md', offset: 14 },
    ])
  })
})
