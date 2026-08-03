import { toast } from 'sonner'

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { rememberDefaultModel } from '../actions'
import { useGeneralSettingsStore } from '../store'

const mocks = vi.hoisted(() => ({
  updateSettings: vi.fn(),
}))

vi.mock('@/api/generalSettingsApi', () => ({
  generalSettingsApi: {
    updateSettings: mocks.updateSettings,
  },
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn() },
}))

describe('generalSettings actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useGeneralSettingsStore.setState({ defaultModelId: '', defaultProviderId: '' })
    mocks.updateSettings.mockResolvedValue({ defaultModelId: 'model-1', defaultProviderId: 'provider-1' })
  })

  it('只在用户显式选择模型时保存最近使用模型', async () => {
    await rememberDefaultModel('model-1', 'provider-1')

    expect(mocks.updateSettings).toHaveBeenCalledWith({
      defaultModelId: 'model-1',
      defaultProviderId: 'provider-1',
    })
    expect(useGeneralSettingsStore.getState()).toMatchObject({
      defaultModelId: 'model-1',
      defaultProviderId: 'provider-1',
    })
  })

  it('重复选择当前模型不产生保存请求', async () => {
    useGeneralSettingsStore.setState({ defaultModelId: 'model-1', defaultProviderId: 'provider-1' })

    await rememberDefaultModel('model-1', 'provider-1')

    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })

  it('保存失败且用户未再选择时回滚到原值并提示', async () => {
    mocks.updateSettings.mockRejectedValue(new Error('network'))

    await rememberDefaultModel('model-1', 'provider-1')

    expect(useGeneralSettingsStore.getState()).toMatchObject({
      defaultModelId: '',
      defaultProviderId: '',
    })
    expect(toast.error).toHaveBeenCalledWith('最近使用模型保存失败')
  })

  it('连续切换模型时串行保存，后返回的旧请求不覆盖最新选择', async () => {
    let resolveFirst!: (value: unknown) => void
    mocks.updateSettings
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ defaultModelId: 'model-2', defaultProviderId: 'provider-2' })

    const first = rememberDefaultModel('model-1', 'provider-1')
    const second = rememberDefaultModel('model-2', 'provider-2')

    // 本地状态始终是最近一次选择
    expect(useGeneralSettingsStore.getState()).toMatchObject({
      defaultModelId: 'model-2',
      defaultProviderId: 'provider-2',
    })

    await Promise.resolve()
    // 串行队列：第一个保存未完成时，第二个请求不能先发出
    expect(mocks.updateSettings).toHaveBeenCalledTimes(1)
    expect(mocks.updateSettings).toHaveBeenNthCalledWith(1, { defaultModelId: 'model-1', defaultProviderId: 'provider-1' })

    // 第一个保存返回旧值，但本地已是 model-2，不做覆盖
    resolveFirst({ defaultModelId: 'model-1', defaultProviderId: 'provider-1' })
    await first

    // 第一个完成后才发出第二个请求
    expect(mocks.updateSettings).toHaveBeenCalledTimes(2)
    expect(mocks.updateSettings).toHaveBeenNthCalledWith(2, { defaultModelId: 'model-2', defaultProviderId: 'provider-2' })
    await second

    expect(useGeneralSettingsStore.getState()).toMatchObject({
      defaultModelId: 'model-2',
      defaultProviderId: 'provider-2',
    })
  })
})
