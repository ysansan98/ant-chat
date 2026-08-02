import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { browserProfilesApi } from '@/api/browserProfilesApi'
import { BrowserProfilesSettings } from './BrowserProfiles'

vi.mock('@/api/browserProfilesApi', () => ({
  browserProfilesApi: {
    getStatus: vi.fn(),
    listSources: vi.fn(),
    importSource: vi.fn(),
    importFromDirectory: vi.fn(),
    clear: vi.fn(),
  },
}))

vi.mock('@/api/transports/appRpc', () => ({
  getAppRuntimeCapabilities: () => ({ nativeWindow: false, autoUpdate: false, nativeFilePicker: false }),
}))

describe('浏览器设置页', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(browserProfilesApi.getStatus).mockResolvedValue({ imported: false })
    vi.mocked(browserProfilesApi.listSources).mockResolvedValue([
      { sourceId: 'chrome-work', browserName: 'Chrome', profileName: '工作账号', available: true },
    ])
    vi.mocked(browserProfilesApi.importSource).mockResolvedValue({ imported: true, browserName: 'Chrome', profileName: '工作账号', importedAt: 1, sourceAvailable: true })
  })

  it('显示发现的 Profile，并可选择导入', async () => {
    render(<BrowserProfilesSettings />)

    await waitFor(() => expect(screen.getByText('选择一个已发现的 Chrome、Edge、Chromium 或 Brave Profile 开始导入。')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '选择浏览器 Profile' }))
    fireEvent.click(await screen.findByRole('button', { name: /Chrome 工作账号/ }))

    await waitFor(() => expect(browserProfilesApi.importSource).toHaveBeenCalledWith('chrome-work'))
    expect(await screen.findByText('已导入')).toBeInTheDocument()
  })

  it('导入失败后保留当前来源展示', async () => {
    vi.mocked(browserProfilesApi.getStatus).mockResolvedValue({ imported: true, browserName: 'Edge', profileName: '默认', importedAt: 1, sourceAvailable: true })
    vi.mocked(browserProfilesApi.importSource).mockRejectedValue(new Error('源浏览器正在运行'))

    render(<BrowserProfilesSettings />)
    await waitFor(() => expect(screen.getByText('Edge')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '更新导入' }))

    await waitFor(() => expect(browserProfilesApi.importSource).toHaveBeenCalledWith(undefined))
    expect(screen.getByText('Edge')).toBeInTheDocument()
    expect(screen.getByText('默认')).toBeInTheDocument()
  })
})
