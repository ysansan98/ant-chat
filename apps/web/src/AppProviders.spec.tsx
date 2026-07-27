import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppProviders } from './AppProviders'

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
}))

vi.mock('@/api/transports/appRpc', () => ({
  getAppRpcClient: () => ({ call: mocks.call }),
}))

vi.mock('@/hooks/useThemeApplier', () => ({
  useThemeApplier: vi.fn(),
}))

vi.mock('@/store/generalSettings/actions', () => ({
  initializeGeneralSettings: vi.fn(),
}))

describe('应用根壳命令宿主警告', () => {
  beforeEach(() => {
    mocks.call.mockReset()
  })

  it('命令宿主不可用时持续显示可关闭的恢复建议', async () => {
    mocks.call.mockResolvedValue({
      status: 'unavailable',
      platform: 'windows',
      candidates: ['pwsh.exe', 'powershell.exe', 'cmd.exe'],
      reason: '未找到可执行的命令解释器',
    })

    const view = render(<AppProviders><div>当前页面</div></AppProviders>)

    expect(await screen.findByText('命令执行功能已停用')).toBeInTheDocument()
    expect(mocks.call).toHaveBeenCalledWith('runtime.getCommandHostStatus', undefined)
    expect(screen.getByText(/PowerShell 7/)).toBeInTheDocument()
    expect(screen.getByText(/powershell\.exe/)).toBeInTheDocument()
    expect(screen.getByText(/cmd\.exe/)).toBeInTheDocument()

    view.rerender(<AppProviders><div>另一个页面</div></AppProviders>)
    expect(screen.getByText('命令执行功能已停用')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '关闭命令宿主警告' }))
    expect(screen.queryByText('命令执行功能已停用')).not.toBeInTheDocument()
  })

  it('命令宿主可用时不显示警告', async () => {
    mocks.call.mockResolvedValue({
      status: 'available',
      platform: 'posix',
      interpreter: 'bash',
      executablePath: '/bin/bash',
    })

    render(<AppProviders><div>当前页面</div></AppProviders>)

    await waitFor(() => expect(mocks.call).toHaveBeenCalledWith('runtime.getCommandHostStatus', undefined))
    expect(screen.queryByText('命令执行功能已停用')).not.toBeInTheDocument()
  })

  it('缺少 Bash 的 POSIX 宿主显示对应恢复建议', async () => {
    mocks.call.mockResolvedValue({
      status: 'unavailable',
      platform: 'posix',
      candidates: ['bash'],
      reason: '未找到 Bash',
    })

    render(<AppProviders><div>当前页面</div></AppProviders>)

    expect(await screen.findByText(/请检查 Bash 是否已安装且可执行/)).toBeInTheDocument()
  })
})
