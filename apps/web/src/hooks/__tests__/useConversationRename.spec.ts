import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useConversationRename } from '../useConversationRename'

describe('useConversationRename', () => {
  // 测试初始状态
  it('should initialize with default values', () => {
    const { result } = renderHook(() => useConversationRename())

    expect(result.current.isRenameModalOpen).toBe(false)
    expect(result.current.newName).toBe('')
    expect(result.current.renameId).toBe('')
  })

  // 测试打开重命名模态框
  it('should open rename modal with correct values', () => {
    const { result } = renderHook(() => useConversationRename())

    act(() => {
      result.current.openRenameModal('test-id', 'Test Chat')
    })

    expect(result.current.isRenameModalOpen).toBe(true)
    expect(result.current.renameId).toBe('test-id')
    expect(result.current.newName).toBe('Test Chat')
  })

  // 测试关闭重命名模态框
  it('should close rename modal and reset values', () => {
    const { result } = renderHook(() => useConversationRename())

    // 先打开模态框
    act(() => {
      result.current.openRenameModal('test-id', 'Test Chat')
    })

    // 然后关闭模态框
    act(() => {
      result.current.closeRenameModal()
    })

    expect(result.current.isRenameModalOpen).toBe(false)
    expect(result.current.renameId).toBe('')
    expect(result.current.newName).toBe('')
  })

  // 测试更改名称
  it('should update newName when changeRename is called', () => {
    const { result } = renderHook(() => useConversationRename())

    act(() => {
      result.current.openRenameModal('test-id', 'Test Chat')
      result.current.changeRename('Updated Chat Name')
    })

    expect(result.current.newName).toBe('Updated Chat Name')
  })

  // 测试完整的重命名流程
  it('should handle complete rename flow correctly', () => {
    const { result } = renderHook(() => useConversationRename())

    // 打开模态框
    act(() => {
      result.current.openRenameModal('test-id', 'Original Name')
    })

    expect(result.current.isRenameModalOpen).toBe(true)
    expect(result.current.renameId).toBe('test-id')
    expect(result.current.newName).toBe('Original Name')

    // 更改名称
    act(() => {
      result.current.changeRename('New Chat Name')
    })

    expect(result.current.newName).toBe('New Chat Name')

    // 关闭模态框
    act(() => {
      result.current.closeRenameModal()
    })

    expect(result.current.isRenameModalOpen).toBe(false)
    expect(result.current.renameId).toBe('')
    expect(result.current.newName).toBe('')
  })
})
